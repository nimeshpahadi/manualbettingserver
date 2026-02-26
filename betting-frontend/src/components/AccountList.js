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
        className={`hover:text-green-400 ${
          bet.status === "successful" ? "text-green-500" : "text-gray-400"
        }`}
      >
        <CheckCircle className="w-6 h-6" />
      </button>
      <button
        onClick={() => onChange("failed")}
        title="Mark as Failed"
        className={`hover:text-red-400 ${
          bet.status === "failed" ? "text-red-500" : "text-gray-400"
        }`}
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

  // Keep refs updated with latest state values
  useEffect(() => {
    accountIdRef.current = accountId;
  }, [accountId]);

  useEffect(() => {
    if (account?.name) {
      document.title = account.name;
    } else {
      document.title = "Manual Betting Server";
    }

    // Optional cleanup when component unmounts
    return () => {
      document.title = "Manual Betting Server";
    };
  }, [account]);

  useEffect(() => {
    selectedBatchIdRef.current = selectedBatchId;
  }, [selectedBatchId]);

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
        // Switch to account if batch created for different account
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
            // Remove deleted batches
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
      } catch (err) {
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
                bets: batch.bets.map((b) => (b.pid === updated.pid ? { ...b, status: updated.status } : b)),
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

      // If the removed batch was selected, choose another one
      if (selectedBatchIdRef.current === removedId) {
        const next = remaining[0]?.id || null;
        setSelectedBatchId(next);
      }

      return remaining;
    });
  } catch (err) {
    console.error("Failed to submit batch", err);
  }
};

  if (loading)
    return (
      <div className="min-h-screen bg-gray-900 text-white flex justify-center items-center">
        Loading...
      </div>
    );
  if (error)
    return (
      <div className="min-h-screen bg-gray-900 text-red-400 flex justify-center items-center">
        {error}
      </div>
    );

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="lg:hidden flex items-center justify-between p-3 border-b border-gray-800">
        <h1 className="text-lg font-bold">Batches</h1>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-white">
          <Menu className="w-6 h-6" />
        </button>
      </div>
      <div className="lg:grid lg:grid-cols-4">
        {/* Sidebar Drawer */}
        <aside
          className={`fixed z-40 lg:static top-0 left-0 h-full lg:h-auto w-64 lg:w-auto transform transition-transform duration-200 ease-in-out bg-gray-800 border-r border-gray-700 p-4 space-y-6 lg:block ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
          }`}
        >
          <div className="flex justify-between items-center lg:hidden mb-4">
            <h2 className="text-white text-lg">Accounts</h2>
            <button onClick={() => setSidebarOpen(false)} className="text-white">
              ✕
            </button>
          </div>

          <div>
            <h2 className="text-xs text-gray-400 uppercase tracking-wider mb-2">Accounts</h2>
            <ul className="space-y-2">
              {accounts.map((acc) => (
                <li key={acc.id}>
                  <button
                    className={`w-full px-3 py-1.5 rounded-md border font-medium truncate text-left ${
                      accountId === acc.id
                        ? "bg-blue-900/50 border-blue-400 text-blue-200"
                        : "border-gray-600 text-gray-300 hover:bg-gray-700/40"
                    }`}
                    onClick={() => {
                      setAccountId(acc.id);
                      setSidebarOpen(false);
                    }}
                  >
                    <User className="w-4 h-4 inline-block mr-1" />
                    {acc.name || `Account ${acc.id}`}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="text-xs text-gray-400 mb-2 uppercase tracking-wider">Batches</h3>
            <ul className="space-y-2 max-h-52 overflow-auto pr-1">
              {batches.map((batch) => (
                <li key={batch.id}>
                  <button
                    className={`w-full px-3 py-1.5 rounded-md border flex items-center gap-2 truncate ${
                      selectedBatchId === batch.id
                        ? "bg-blue-900/50 border-blue-400 text-blue-200"
                        : "border-gray-600 text-gray-300 hover:bg-gray-700/50"
                    }`}
                    onClick={() => {
                      setSelectedBatchId(batch.id);
                      setSidebarOpen(false);
                    }}
                  >
                    <Package className="w-4 h-4" />
                    {batch.meta?.name || `Batch ${batch.id}`}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {account && (
            <div className="border-t border-gray-600 pt-3 text-xs text-gray-400 space-y-1">
              <div>
                <User className="inline w-4 h-4 mr-1" /> {account.name || "Unnamed"}
              </div>
              <div>Total Batches: {batches.length}</div>
              <div>Active: {batches.filter((b) => !b.completed).length}</div>
              <div>Completed: {batches.filter((b) => b.completed).length}</div>
            </div>
          )}
        </aside>

        {/* Main content */}
        <main className="lg:col-span-3 p-4">
          <section className="lg:col-span-3 space-y-4">
            {selectedBatch && (
              <div className="space-y-4">
                <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                  {/* Batch Info */}
                  <div className="flex justify-between items-center mb-4">
                    <h1 className="text-lg font-bold">
                      {selectedBatch.meta?.name || `Batch ${selectedBatch.id}`}
                    </h1>
                    <span
                      className={`px-3 py-1 text-sm rounded-full border ${
                        selectedBatch.completed
                          ? "text-green-300 border-green-600 bg-green-900/20"
                          : "text-orange-300 border-orange-600 bg-orange-900/20"
                      }`}
                    >
                      {selectedBatch.completed ? "Completed" : "Active"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm text-gray-300 mb-4">
                    <div>
                      <Calendar className="inline w-4 h-4 mr-1" />{" "}
                      {formatDate(selectedBatch.created_at)}
                    </div>
                    <div>
                      <Target className="inline w-4 h-4 mr-1" /> Total Bets:{" "}
                      {selectedBatch.bets?.length || 0}
                    </div>
                    <div>
                      <DollarSign className="inline w-4 h-4 mr-1" /> Total Stake: $
                      {calculateTotalStake(selectedBatch.bets)}
                    </div>
                  </div>

                  {/* Metadata Block */}
                  <h3 className="mb-1 text-gray-300 font-semibold">Metadata:</h3>
                  {selectedBatch.meta && (
                    <>
                      <pre className="bg-gray-800 border border-gray-700 rounded-lg p-3 overflow-auto text-gray-200 text-xs">
                        {JSON.stringify(selectedBatch.meta, null, 2)}
                      </pre>

                      {/* Status Badges */}
                      <div className="flex flex-wrap gap-2 mt-3">
                        {(() => {
                          const { successful, failed, pending } = getStatusCounts(
                            selectedBatch.bets
                          );
                          return (
                            <>
                              <span className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-full bg-green-900/20 text-green-300 border border-green-600">
                                {successful}
                              </span>
                              <span className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-full bg-red-900/20 text-red-300 border border-red-600">
                                {failed}
                              </span>
                              <span className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-full bg-yellow-900/20 text-yellow-300 border border-yellow-600">
                                {pending}
                              </span>
                            </>
                          );
                        })()}
                      </div>
                    </>
                  )}
                </div>

                {/* Bets Table */}
                <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-x-auto">
                  <table className="min-w-full text-sm text-center">
                    <thead className="bg-gray-700 text-gray-300">
                      <tr>
                        <th className="px-4 py-2">#</th>
                        <th className="px-4 py-2">Selection</th>
                        <th className="px-4 py-2">Stake</th>
                        <th className="px-4 py-2">Cost</th>
                        <th className="px-4 py-2">Status</th>
                        <th className="px-4 py-2">Update Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedBatch.bets?.map((bet) => (
                        <tr
                          key={bet.pid}
                          className={`border-t border-gray-700 ${
                            bet.status === "successful"
                              ? "bg-green-900/20"
                              : bet.status === "failed"
                              ? "bg-red-900/20"
                              : ""
                          }`}
                        >
                          <td className="px-4 py-2">{bet.id}</td>
                          <td className="px-4 py-2 w-64">
                            <details className="bg-gray-800 border border-gray-700 rounded-md">
                              <summary className="text-white font-medium truncate whitespace-nowrap overflow-hidden">
                                {bet.selection}
                              </summary>
                              <div className="p-2">
                                <pre className="whitespace-pre-line text-sm text-gray-300 break-words">
                                  {formatSelection(bet.selection)}
                                </pre>
                              </div>
                            </details>
                          </td>
                          <td className="px-4 py-2">${bet.stake}</td>
                          <td className="px-4 py-2">${bet.cost}</td>
                          <td className="px-4 py-2">{bet.status}</td>
                          <td className="px-4 py-2">
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

                {/* Action Buttons */}
                <div className="flex justify-end space-x-4">
                  <button onClick={handleSubmitBatch} className="bg-green-700 text-white px-2 py-1 rounded-md hover:bg-green-800">
                    Submit
                  </button>
                </div>
              </div>
            )}
          {!selectedBatch && (
            <div className="flex justify-center items-center h-64 text-yellow-300 text-lg font-semibold">
              No active batch
            </div>
          )}
          </section>
        </main>
      </div>
    </div>
  );
}
