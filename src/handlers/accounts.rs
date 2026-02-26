use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{
        sse::{Event, Sse, KeepAlive},
        Json,
    },
    Json as JsonExtract,
};
use futures::stream::Stream;
use futures::StreamExt;
use sqlx::SqlitePool;
use std::{convert::Infallible, time::Duration};
use tokio::sync::broadcast;
use tokio_stream::wrappers::BroadcastStream;
use crate::models::account::*;

// Global event broadcaster
pub type EventSender = broadcast::Sender<BrokerEvent>;

// Application state that includes the event broadcaster
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub event_sender: EventSender,
}

// SSE endpoint handler
pub async fn sse_handler(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.event_sender.subscribe();
    
    let event_stream = BroadcastStream::new(rx)
        .then(|result| async move {
            let event = result.ok()?;
            let event_name = event.event_name();
            
            // Serialize the event data
            let data = match serde_json::to_string(&event) {
                Ok(json) => json,
                Err(e) => {
                    eprintln!("Failed to serialize event: {}", e);
                    return None;
                }
            };

            Some(Ok(Event::default()
                .event(event_name)
                .data(data)))
        })
        .filter_map(|x| async { x });

    Sse::new(event_stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

/// Get all accounts
#[utoipa::path(
    get,
    path = "/api/v1/accounts",
    responses(
        (status = 200, description = "List of accounts retrieved successfully", body = Vec<Account>),
        (status = 500, description = "Internal server error")
    ),
    tag = "accounts"
)]
pub async fn get_accounts(
    State(state): State<AppState>,
) -> Result<Json<Vec<Account>>, StatusCode> {
    let accounts = sqlx::query_as::<_, Account>("SELECT * FROM accounts ORDER BY created_at DESC")
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            eprintln!("Database error fetching accounts: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(accounts))
}

/// Get account by ID
#[utoipa::path(
    get,
    path = "/api/v1/accounts/{id}",
    params(
        ("id" = i64, Path, description = "Account ID")
    ),
    responses(
        (status = 200, description = "Account found", body = Account),
        (status = 404, description = "Account not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "accounts"
)]
pub async fn get_account(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<Account>, StatusCode> {
    let account = sqlx::query_as::<_, Account>("SELECT * FROM accounts WHERE id = ?")
        .bind(id)
        .fetch_one(&state.pool)
        .await
        .map_err(|e| {
            eprintln!("Database error fetching account: {}", e);
            StatusCode::NOT_FOUND
        })?;

    Ok(Json(account))
}

/// Create a new account
#[utoipa::path(
    post,
    path = "/api/v1/accounts",
    request_body = CreateAccountRequest,
    responses(
        (status = 200, description = "Account created successfully", body = Account),
        (status = 400, description = "Bad request"),
        (status = 500, description = "Internal server error")
    ),
    tag = "accounts"
)]
pub async fn create_account(
    State(state): State<AppState>,
    JsonExtract(payload): JsonExtract<CreateAccountRequest>,
) -> Result<Json<Account>, StatusCode> {
    let account = sqlx::query_as::<_, Account>(
        r#"
        INSERT INTO accounts (name, hostname, created_at, updated_at)
        VALUES (?, ?, datetime('now'), datetime('now'))
        RETURNING *
        "#,
    )
    .bind(&payload.name)
    .bind(&payload.hostname)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        eprintln!("Database error inserting account: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let _ = state.event_sender.send(BrokerEvent::AccountCreated {
            account: account.clone(),
        });

    println!(
        "Account created - ID: {}, Name: {}, Hostname: {}",
        account.id, account.name, account.hostname
    );

    Ok(Json(account))
}

/// Update an existing account
#[utoipa::path(
    put,
    path = "/api/v1/accounts/{id}",
    params(
        ("id" = i64, Path, description = "Account ID")
    ),
    request_body = CreateAccountRequest,
    responses(
        (status = 200, description = "Account updated successfully", body = Account),
        (status = 404, description = "Account not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "accounts"
)]
pub async fn update_account(
    State(state): State<AppState>,
    Path(account_id): Path<i64>,
    JsonExtract(payload): JsonExtract<CreateAccountRequest>,
) -> Result<Json<Account>, StatusCode> {
    let account = sqlx::query_as::<_, Account>(
        r#"
        UPDATE accounts 
        SET name = ?, hostname = ?, updated_at = datetime('now')
        WHERE id = ?
        RETURNING *
        "#,
    )
    .bind(&payload.name)
    .bind(&payload.hostname)
    .bind(account_id)
    .fetch_one(&state.pool)
    .await
    .map_err(|e| {
        eprintln!("Database error updating account: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let _ = state.event_sender.send(BrokerEvent::AccountUpdated {
            account: account.clone(),
        });

    println!(
        "Account updated - ID: {}, Name: {}, Hostname: {}",
        account.id, account.name, account.hostname
    );

    Ok(Json(account))
}

/// Create a new batch for an account
#[utoipa::path(
    post,
    path = "/api/v1/accounts/{id}/batches",
    params(
        ("id" = i64, Path, description = "Account ID")
    ),
    request_body = CreateBatchRequest,
    responses(
        (status = 200, description = "Batch created successfully", body = BatchResponse),
        (status = 400, description = "Bad request"),
        (status = 404, description = "Account not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "batches"
)]
pub async fn create_batch(
    Path(account_id): Path<i64>,
    State(state): State<AppState>,
    JsonExtract(payload): JsonExtract<CreateBatchRequest>,
) -> Result<Json<BatchResponse>, StatusCode> {
    let mut tx = state.pool.begin().await.map_err(|e| {
        eprintln!("Transaction begin error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let meta_json = serde_json::to_string(&payload.meta).map_err(|e| {
        eprintln!("JSON serialization error: {}", e);
        StatusCode::BAD_REQUEST
    })?;

    let batch = sqlx::query_as::<_, Batch>(
        r#"
        INSERT INTO batches (meta, account_id, created_at, updated_at)
        VALUES (?, ?, datetime('now'), datetime('now'))
        RETURNING *
        "#,
    )
    .bind(&meta_json)
    .bind(account_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        eprintln!("Database error creating batch: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let mut bets = Vec::new();
    for bet_request in payload.bets {
        let bet = sqlx::query_as::<_, Bet>(
            r#"
            INSERT INTO bets (id, selection, stake, cost, batch_id)
            VALUES (?, ?, ?, ?, ?)
            RETURNING *
            "#,
        )
        .bind(bet_request.id)
        .bind(&bet_request.selection)
        .bind(bet_request.stake)
        .bind(bet_request.cost)
        .bind(batch.id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| {
            eprintln!("Database error creating bet: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
        bets.push(bet);
    }

    tx.commit().await.map_err(|e| {
        eprintln!("Transaction commit error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;


    let response = BatchResponse {
        id: batch.id,
        completed: batch.completed,
        created_at: batch.created_at.to_rfc3339(),
        updated_at: batch.updated_at.to_rfc3339(),
        meta: batch.meta,
        account_id: batch.account_id,
        bets: bets.clone(),
    };
    
    let _ = state.event_sender.send(BrokerEvent::BatchCreated {
        batch: response.clone(),
    });

    println!(
        "Batch created - ID: {}, Account: {}, Bets: {}",
        response.id, response.account_id, response.bets.len()
    );

    Ok(Json(response))
}

/// Get all batches for an account
#[utoipa::path(
    get,
    path = "/api/v1/accounts/{id}/batches",
    params(
        ("id" = i64, Path, description = "Account ID")
    ),
    responses(
        (status = 200, description = "List of batches retrieved successfully", body = Vec<BatchResponse>),
        (status = 404, description = "Account not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "batches"
)]
pub async fn account_batches(
    Path(account_id): Path<i64>,
    State(state): State<AppState>,
) -> Result<Json<Vec<BatchResponse>>, StatusCode> {
    let batches = sqlx::query_as::<_, Batch>(
        r#"
        SELECT * FROM batches 
        WHERE account_id = ? 
        ORDER BY created_at DESC
        "#,
    )
    .bind(account_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        eprintln!("Database error fetching batches: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let mut batch_responses = Vec::new();

    for batch in batches {
        let bets = sqlx::query_as::<_, Bet>(
            r#"
            SELECT * FROM bets 
            WHERE batch_id = ? 
            ORDER BY id
            "#,
        )
        .bind(batch.id)
        .fetch_all(&state.pool)
        .await
        .map_err(|e| {
            eprintln!("Database error fetching bets for batch {}: {}", batch.id, e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        let response = BatchResponse {
            id: batch.id,
            completed: batch.completed,
            created_at: batch.created_at.to_rfc3339(),
            updated_at: batch.updated_at.to_rfc3339(),
            meta: batch.meta.clone(),
            account_id: batch.account_id,
            bets,
        };

        batch_responses.push(response);
    }

    println!(
        "Retrieved {} batches for account {}",
        batch_responses.len(),
        account_id
    );

    Ok(Json(batch_responses))
}

/// Update multiple bets in a batch
#[utoipa::path(
    patch,
    path = "/api/v1/accounts/{id}/batches/{batch_id}/bets",
    params(
        ("id" = i64, Path, description = "Account ID"),
        ("batch_id" = i64, Path, description = "Batch ID")
    ),
    request_body = Vec<BetUpdateRequest>,
    responses(
        (status = 200, description = "Bets updated successfully", body = Vec<Bet>),
        (status = 404, description = "Batch not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "bets"
)]
pub async fn update_account_batch_bets(
    Path((account_id, batch_id)): Path<(i64, i64)>,
    State(state): State<AppState>,
    Json(bets): Json<Vec<BetUpdateRequest>>,
) -> Result<Json<Vec<Bet>>, StatusCode> {
    let mut tx = state.pool.begin().await.map_err(|e| {
        eprintln!("Transaction begin error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let mut updated_bets = Vec::new();
    for bet in bets {
        let result = sqlx::query_as::<_, Bet>(
            r#"
            UPDATE bets SET status = 'successful'
            WHERE pid = ? AND batch_id = ?
            RETURNING *
            "#,
        )
        .bind(bet.pid)
        .bind(batch_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| {
            eprintln!("Failed to update bet status to successful: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

        updated_bets.push(result);
    }

    tx.commit().await.map_err(|e| {
        eprintln!("Transaction commit error: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    
    let _ = state.event_sender.send(BrokerEvent::BatchBetsUpdated {
        batch_id,
        account_id,
        bets: updated_bets.clone(),
    });

    Ok(Json(updated_bets))
}

/// Update a single bet status
#[utoipa::path(
    patch,
    path = "/api/v1/accounts/{id}/batches/{batch_id}/bets/{bet_id}",
    params(
        ("id" = i64, Path, description = "Account ID"),
        ("batch_id" = i64, Path, description = "Batch ID"),
        ("bet_id" = i64, Path, description = "Bet ID (pid)")
    ),
    request_body = UpdateBetStatusRequest,
    responses(
        (status = 200, description = "Bet status updated successfully", body = Bet),
        (status = 404, description = "Bet not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "bets"
)]
pub async fn update_account_batch_bet(
    Path((account_id, batch_id, bet_id)): Path<(i64, i64, i64)>,
    State(state): State<AppState>,
    Json(payload): Json<UpdateBetStatusRequest>,
) -> Result<Json<Bet>, StatusCode> {
    let validated_status = match payload.status {
        BetStatus::Pending => "pending",
        BetStatus::Successful => "successful",
        BetStatus::Failed => "failed",
    };

    let updated_bet = sqlx::query_as::<_, Bet>(
        r#"
        UPDATE bets 
        SET status = ? 
        WHERE pid = ? AND batch_id = ?
        RETURNING *
        "#
    )
    .bind(validated_status)
    .bind(bet_id)
    .bind(batch_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        eprintln!("Database error updating bet: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    match updated_bet {
        Some(bet) => {
            let _ = state.event_sender.send(BrokerEvent::BetStatusUpdated {
                bet: bet.clone(),
            });
            Ok(Json(bet))
        }
        None => {
            eprintln!("❌ Bet not found: pid={}, batch_id={}", bet_id, batch_id);
            Err(StatusCode::NOT_FOUND)
        }
    }
}

/// Complete a batch
#[utoipa::path(
    delete,
    path = "/api/v1/accounts/{id}/batches/{batch_id}",
    params(
        ("id" = i64, Path, description = "Account ID"),
        ("batch_id" = i64, Path, description = "Batch ID")
    ),
    responses(
        (status = 200, description = "Batch completed successfully"),
        (status = 404, description = "Batch not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "batches"
)]
pub async fn complete_account_batch(
    State(state): State<AppState>,
    Path((account_id, batch_id)): Path<(i64, i64)>,
) -> Result<(), StatusCode> {
    let result = sqlx::query(
        r#"
        UPDATE batches 
        SET completed = 1, updated_at = datetime('now')
        WHERE id = ? AND account_id = ? AND completed = 0
        "#,
    )
    .bind(batch_id)
    .bind(account_id)
    .execute(&state.pool)
    .await
    .map_err(|e| {
        eprintln!("Failed to mark batch as completed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    let _ = state.event_sender.send(BrokerEvent::BatchCompleted {
        id: batch_id,
        account_id,
    });

    Ok(())
}

/// Delete an account
#[utoipa::path(
    delete,
    path = "/api/v1/accounts/{id}",
    params(
        ("id" = i64, Path, description = "Account ID")
    ),
    responses(
        (status = 204, description = "Account deleted successfully"),
        (status = 404, description = "Account not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "accounts"
)]
pub async fn delete_account(
    State(state): State<AppState>,
    Path(account_id): Path<i64>,
) -> Result<StatusCode, StatusCode> {
    // Delete account (CASCADE will handle batches and bets automatically)
    let result = sqlx::query("DELETE FROM accounts WHERE id = ?")
        .bind(account_id)
        .execute(&state.pool)
        .await
        .map_err(|e| {
            eprintln!("Database error deleting account: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Check if account existed
    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    let _ = state.event_sender.send(BrokerEvent::AccountDeleted {
            id: account_id,
        });

    println!("Account deleted - ID: {} (cascaded batches and bets)", account_id);
    Ok(StatusCode::NO_CONTENT)
}
