import { useState, useEffect, useRef } from "react";
import {
  User,
  Calendar,
  DollarSign,
  Target,
  CheckCircle,
  XCircle,
  Package,
  Menu,
} from "lucide-react";
import {
  getAccounts,
  getAccount,
  getAccountBatches,
  subscribeToAccountEvents,
  updateBetStatus,
  submitBatch,
} from "../api/accounts";
function formatSelection(selection) {
  if (!selection) return "";
  const trimmed = selection.split("**")[0].trim();
  return trimmed
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n");
}

function BetStatusSelector({ bet, onChange }) {
  return (
    <div className="flex justify-center items-center space-x-4">
      <button
        onClick={() => onChange("successful")}
        title="Mark as Successful"
        style={{
          color: bet.status === "successful" ? "#22c55e" : "#4a5270",
          transition: "color .15s",
        }}
        onMouseEnter={e => e.currentTarget.style.color = "#22c55e"}
        onMouseLeave={e => e.currentTarget.style.color = bet.status === "successful" ? "#22c55e" : "#4a5270"}
      >
        <CheckCircle className="w-6 h-6" />
      </button>
      <button
        onClick={() => onChange("failed")}
        title="Mark as Failed"
        style={{
          color: bet.status === "failed" ? "#ef4444" : "#4a5270",
          transition: "color .15s",
        }}
        onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
        onMouseLeave={e => e.currentTarget.style.color = bet.status === "failed" ? "#ef4444" : "#4a5270"}
      >
        <XCircle className="w-6 h-6" />
      </button>
    </div>
  );
}

export default function AccountBatchesUI() {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState(null);
  const [batches, setBatches] = useState([]);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedBatchId, setSelectedBatchId] = useState(null);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const accountIdRef = useRef(accountId);
  const selectedBatchIdRef = useRef(selectedBatchId);

  useEffect(() => { accountIdRef.current = accountId; }, [accountId]);

  useEffect(() => {
    if (account?.name) {
      document.title = account.name;
    } else {
      document.title = "Betstream";
    }
    return () => { document.title = "Betstream"; };
  }, [account]);

  useEffect(() => { selectedBatchIdRef.current = selectedBatchId; }, [selectedBatchId]);

  const selectedBatch = batches.find((b) => b.id === selectedBatchId);

  useEffect(() => {
    const loadInitialAccounts = async () => {
      try {
        const data = await getAccounts();
        setAccounts(data);
        if (data.length > 0) setAccountId(data[0].id);
      } catch {
        setError("Failed to load accounts");
      }
    };
    loadInitialAccounts();

    const es = subscribeToAccountEvents(
      (newAccount) => {
        if (!newAccount.id) return;
        setAccounts((prev) =>
          prev.some((acc) => acc.id === newAccount.id) ? prev : [newAccount, ...prev]
        );
        setAccountId(newAccount.id);
      },
      (deletedId) => {
        setAccounts((prev) => {
          const filtered = prev.filter((acc) => acc.id !== deletedId);
          setAccountId((prevId) => {
            if (prevId === deletedId) {
              setBatches([]);
              setSelectedBatchId(null);
              return filtered[0]?.id ?? null;
            }
            return prevId;
          });
          return filtered;
        });
      },
      (batchData) => {
        if (batchData.account_id !== accountIdRef.current && !batchData.completed) {
          setAccountId(batchData.account_id);
        }
        if (batchData.account_id === accountIdRef.current) {
          if (!batchData.completed) {
            setBatches((prev) => {
              if (prev.some((b) => b.id === batchData.id)) return prev;
              if (!selectedBatchIdRef.current) {
                setSelectedBatchId(batchData.id);
              }
              return [batchData, ...prev];
            });
          } else {
            setBatches((prev) => prev.filter((b) => b.id !== batchData.id));
            if (selectedBatchIdRef.current === batchData.id) {
              setSelectedBatchId(null);
            }
          }
        }
      },
      console.log,
      (updatedBet) => {
        setBatches((prev) =>
          prev.map((batch) =>
            batch.id === updatedBet.batch_id
              ? {
                  ...batch,
                  bets: batch.bets.map((bet) =>
                    bet.pid === updatedBet.pid ? { ...bet, status: updatedBet.status } : bet
                  ),
                }
              : batch
          )
        );
      }
    );

    return () => es.close();
  }, []);

  useEffect(() => {
    if (!accountId) {
      setAccount(null);
      setBatches([]);
      setSelectedBatchId(null);
      setLoading(false);
      return;
    }
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const [accountData, batchesData] = await Promise.all([
          getAccount(accountId),
          getAccountBatches(accountId),
        ]);
        const active = batchesData.filter((batch) => !batch.completed);
        setAccount(accountData);
        setBatches(active);
        setSelectedBatchId(active[0]?.id || null);
      } catch {
        setError("Failed to load account and batch data");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [accountId]);

  const formatDate = (d) => new Date(d).toLocaleString("en-US");
  const calculateTotalStake = (bets) =>
    bets.reduce((sum, bet) => sum + (bet.stake || 0), 0).toFixed(2);

  const getStatusCounts = (bets = []) =>
    bets.reduce(
      (acc, b) => {
        if (b.status === "successful") acc.successful++;
        else if (b.status === "failed") acc.failed++;
        else acc.pending++;
        return acc;
      },
      { successful: 0, failed: 0, pending: 0 }
    );

  const handleStatusChange = async (betId, status) => {
    if (!selectedBatch || !accountId) return;
    try {
      const updated = await updateBetStatus(accountId, selectedBatch.id, betId, status);
      setBatches((prev) =>
        prev.map((batch) =>
          batch.id === updated.batch_id
            ? {
                ...batch,
                bets: batch.bets.map((b) =>
                  b.pid === updated.pid ? { ...b, status: updated.status } : b
                ),
              }
            : batch
        )
      );
    } catch (err) {
      console.error("Failed to update bet status", err);
    }
  };

  const handleSubmitBatch = async () => {
    if (!selectedBatch || !accountId) return;
    try {
      const removedId = selectedBatch.id;
      await submitBatch(accountId, removedId);
      setBatches((prev) => {
        const remaining = prev.filter((b) => b.id !== removedId);
        if (selectedBatchIdRef.current === removedId) {
          setSelectedBatchId(remaining[0]?.id || null);
        }
        return remaining;
      });
    } catch (err) {
      console.error("Failed to submit batch", err);
    }
  };

  if (loading)
    return (
      <div style={{ minHeight: "100vh", background: "#07080c", color: "#dde1f0",
        display: "flex", justifyContent: "center", alignItems: "center",
        fontFamily: "'IBM Plex Mono', monospace" }}>
        Loading...
      </div>
    );

  if (error)
    return (
      <div style={{ minHeight: "100vh", background: "#07080c", color: "#ef4444",
        display: "flex", justifyContent: "center", alignItems: "center",
        fontFamily: "'IBM Plex Mono', monospace" }}>
        {error}
      </div>
    );

  return (
    <div style={{ minHeight: "100vh", background: "#07080c", color: "#dde1f0",
      fontFamily: "'IBM Plex Mono', monospace" }}>

      {/* Mobile header */}
      <div className="lg:hidden" style={{ display: "flex", alignItems: "center",
        justifyContent: "space-between", padding: "12px 16px",
        borderBottom: "1px solid #1c2035", background: "#0e1018" }}>
        <span style={{ fontWeight: 700, fontSize: 17 }}>Batches</span>
        <button onClick={() => setSidebarOpen(!sidebarOpen)}
          style={{ background: "none", border: "none", color: "#dde1f0", cursor: "pointer" }}>
          <Menu className="w-6 h-6" />
        </button>
      </div>

      <div className="lg:grid lg:grid-cols-4">

        {/* ── Sidebar ── */}
        <aside style={{
          background: "#0e1018",
          borderRight: "1px solid #1c2035",
          padding: "20px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
          className={`fixed z-40 lg:static top-0 left-0 h-full lg:h-auto w-64 lg:w-auto transform transition-transform duration-200 ease-in-out lg:block ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          }`}
        >
          <div className="flex justify-between items-center lg:hidden" style={{ marginBottom: 8 }}>
            <span style={{ fontWeight: 700 }}>Accounts</span>
            <button onClick={() => setSidebarOpen(false)}
              style={{ background: "none", border: "none", color: "#dde1f0", cursor: "pointer", fontSize: 18 }}>✕</button>
          </div>

          <div>
            <div style={{ fontSize: 10, letterSpacing: "2px", textTransform: "uppercase",
              color: "#4a5270", marginBottom: 10 }}>Accounts</div>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
              {accounts.map((acc) => (
                <li key={acc.id}>
                  <button
                    onClick={() => { setAccountId(acc.id); setSidebarOpen(false); }}
                    onMouseEnter={e => { if (accountId !== acc.id) { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#dde1f0"; }}}
                    onMouseLeave={e => { if (accountId !== acc.id) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8891b0"; }}}
                    style={{
                      width: "100%", textAlign: "left", padding: "8px 12px",
                      borderRadius: 7, border: `1px solid ${accountId === acc.id ? "#f5a623" : "#1c2035"}`,
                      background: accountId === acc.id ? "rgba(245,166,35,0.10)" : "transparent",
                      color: accountId === acc.id ? "#f5a623" : "#8891b0",
                      cursor: "pointer", fontSize: 13,
                      display: "flex", alignItems: "center", gap: 7,
                      fontFamily: "inherit", transition: "all .15s",
                    }}
                  >
                    <User className="w-4 h-4" style={{ flexShrink: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {acc.name || `Account ${acc.id}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div style={{ fontSize: 10, letterSpacing: "2px", textTransform: "uppercase",
              color: "#4a5270", marginBottom: 10 }}>Batches</div>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 6,
              maxHeight: 200, overflowY: "auto" }}>
              {batches.map((batch) => (
                <li key={batch.id}>
                  <button
                    onClick={() => { setSelectedBatchId(batch.id); setSidebarOpen(false); }}
                    onMouseEnter={e => { if (selectedBatchId !== batch.id) { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.color = "#dde1f0"; }}}
                    onMouseLeave={e => { if (selectedBatchId !== batch.id) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#8891b0"; }}}
                    style={{
                      width: "100%", textAlign: "left", padding: "8px 12px",
                      borderRadius: 7, border: `1px solid ${selectedBatchId === batch.id ? "#f5a623" : "#1c2035"}`,
                      background: selectedBatchId === batch.id ? "rgba(245,166,35,0.10)" : "transparent",
                      color: selectedBatchId === batch.id ? "#f5a623" : "#8891b0",
                      cursor: "pointer", fontSize: 13,
                      display: "flex", alignItems: "center", gap: 7,
                      fontFamily: "inherit", transition: "all .15s",
                    }}
                  >
                    <Package className="w-4 h-4" style={{ flexShrink: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {batch.meta?.name || `Batch ${batch.id}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {account && (
            <div style={{ borderTop: "1px solid #1c2035", paddingTop: 14,
              fontSize: 11, color: "#4a5270", display: "flex", flexDirection: "column", gap: 5 }}>
              <div><User className="inline w-3 h-3" style={{ marginRight: 5 }} />{account.name || "Unnamed"}</div>
              <div>Total Batches: {batches.length}</div>
              <div>Active: {batches.filter((b) => !b.completed).length}</div>
              <div>Completed: {batches.filter((b) => b.completed).length}</div>
            </div>
          )}
        </aside>

        {/* ── Main ── */}
        <main className="lg:col-span-3" style={{ padding: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {selectedBatch && (
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                  <div style={{ background: "#0e1018", border: "1px solid #1c2035",
                    borderRadius: 12, padding: 20 }}>

                    <div style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "center", marginBottom: 16 }}>
                      <span style={{ fontSize: 17, fontWeight: 700 }}>
                        {selectedBatch.meta?.name || `Batch ${selectedBatch.id}`}
                      </span>
                      <span style={{
                        padding: "3px 12px", borderRadius: 20, fontSize: 12,
                        border: selectedBatch.completed ? "1px solid #166534" : "1px solid #92400e",
                        background: selectedBatch.completed ? "#052e16" : "#1c0f00",
                        color: selectedBatch.completed ? "#86efac" : "#fcd34d",
                      }}>
                        {selectedBatch.completed ? "Completed" : "Active"}
                      </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 12, fontSize: 12, color: "#8891b0", marginBottom: 16 }}>
                      <div><Calendar className="inline w-4 h-4" style={{ marginRight: 5 }} />{formatDate(selectedBatch.created_at)}</div>
                      <div><Target className="inline w-4 h-4" style={{ marginRight: 5 }} />Total Bets: {selectedBatch.bets?.length || 0}</div>
                      <div><DollarSign className="inline w-4 h-4" style={{ marginRight: 5 }} />Total Stake: ${calculateTotalStake(selectedBatch.bets)}</div>
                    </div>

                    {selectedBatch.meta && (
                      <>
                        <div style={{ fontSize: 12, color: "#8891b0", fontWeight: 600, marginBottom: 8 }}>Metadata:</div>
                        <pre style={{ background: "#07080c", border: "1px solid #1c2035", borderRadius: 8,
                          padding: 12, overflowX: "auto", color: "#dde1f0", fontSize: 11, lineHeight: 1.7 }}>
                          {JSON.stringify(selectedBatch.meta, null, 2)}
                        </pre>

                        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                          {(() => {
                            const { successful, failed, pending } = getStatusCounts(selectedBatch.bets);
                            return (
                              <>
                                <span style={{ padding: "3px 12px", borderRadius: 20, fontSize: 11,
                                  background: "#052e16", color: "#86efac", border: "1px solid #166534" }}>
                                  ✓ {successful}
                                </span>
                                <span style={{ padding: "3px 12px", borderRadius: 20, fontSize: 11,
                                  background: "#2d0a0a", color: "#fca5a5", border: "1px solid #7f1d1d" }}>
                                  ✗ {failed}
                                </span>
                                <span style={{ padding: "3px 12px", borderRadius: 20, fontSize: 11,
                                  background: "#1c1100", color: "#fde68a", border: "1px solid #713f12" }}>
                                  ◌ {pending}
                                </span>
                              </>
                            );
                          })()}
                        </div>
                      </>
                    )}
                  </div>

                  <div style={{ background: "#0e1018", border: "1px solid #1c2035",
                    borderRadius: 12, overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "center" }}>
                      <thead>
                        <tr style={{ background: "#13161f" }}>
                          {["#", "Selection", "Stake", "Cost", "Status", "Update"].map((h) => (
                            <th key={h} style={{ padding: "10px 14px", fontSize: 10,
                              letterSpacing: "1.5px", textTransform: "uppercase",
                              color: "#4a5270", fontWeight: 500,
                              borderBottom: "1px solid #1c2035" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedBatch.bets?.map((bet) => (
                          <tr key={bet.pid}
                            onMouseEnter={e => e.currentTarget.style.background = bet.status === "successful" ? "rgba(34,197,94,0.10)" : bet.status === "failed" ? "rgba(239,68,68,0.10)" : "rgba(255,255,255,0.03)"}
                            onMouseLeave={e => e.currentTarget.style.background = bet.status === "successful" ? "rgba(34,197,94,0.05)" : bet.status === "failed" ? "rgba(239,68,68,0.05)" : "transparent"}
                            style={{
                              borderBottom: "1px solid #1c2035",
                              transition: "background .15s",
                              background: bet.status === "successful"
                                ? "rgba(34,197,94,0.05)"
                                : bet.status === "failed"
                                ? "rgba(239,68,68,0.05)"
                                : "transparent",
                            }}>
                            <td style={{ padding: "10px 14px", color: "#4a5270" }}>{bet.id}</td>
                            <td style={{ padding: "10px 14px", maxWidth: 260 }}>
                              <details style={{ background: "#07080c", border: "1px solid #1c2035",
                                borderRadius: 7, textAlign: "left" }}>
                                <summary style={{ padding: "6px 10px", cursor: "pointer",
                                  color: "#dde1f0", fontWeight: 500,
                                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {bet.selection}
                                </summary>
                                <div style={{ padding: "8px 10px" }}>
                                  <pre style={{ whiteSpace: "pre-line", fontSize: 12,
                                    color: "#8891b0", wordBreak: "break-word" }}>
                                    {formatSelection(bet.selection)}
                                  </pre>
                                </div>
                              </details>
                            </td>
                            <td style={{ padding: "10px 14px" }}>${bet.stake}</td>
                            <td style={{ padding: "10px 14px" }}>${bet.cost}</td>
                            <td style={{ padding: "10px 14px" }}>
                              <span style={{
                                padding: "2px 10px", borderRadius: 20, fontSize: 11,
                                background: bet.status === "successful" ? "#052e16"
                                  : bet.status === "failed" ? "#2d0a0a" : "#1c1100",
                                color: bet.status === "successful" ? "#86efac"
                                  : bet.status === "failed" ? "#fca5a5" : "#fde68a",
                                border: `1px solid ${bet.status === "successful" ? "#166534"
                                  : bet.status === "failed" ? "#7f1d1d" : "#713f12"}`,
                              }}>
                                {bet.status || "pending"}
                              </span>
                            </td>
                            <td style={{ padding: "10px 14px" }}>
                              <BetStatusSelector
                                bet={bet}
                                onChange={(newStatus) => handleStatusChange(bet.pid, newStatus)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <button onClick={handleSubmitBatch} style={{
                      background: "#f5a623", color: "#000", border: "none",
                      padding: "9px 22px", borderRadius: 8, cursor: "pointer",
                      fontFamily: "inherit", fontSize: 13, fontWeight: 600,
                      transition: "background .15s",
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = "#f7ba4a"}
                      onMouseLeave={e => e.currentTarget.style.background = "#f5a623"}
                    >
                      Submit Batch
                    </button>
                  </div>
                </div>
              )}

              {!selectedBatch && (
                <div style={{ height: 240, display: "flex", justifyContent: "center",
                  alignItems: "center", color: "#4a5270", fontSize: 15 }}>
                  No active batch
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
