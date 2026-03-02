import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Send, ChevronDown, ArrowLeft } from "lucide-react";
import { getAccounts } from "../api/accounts";
import axios from "axios";

const BASE_URL = "/api/v1/accounts";

const BET_TYPES = ["WIN", "PLACE", "QUINELLA", "EXACTA", "TRIFECTA"];

const BET_TYPE_HELP = {
  WIN:      { label: "Single horse", placeholder: "e.g. 5" },
  PLACE:    { label: "Single horse", placeholder: "e.g. 5" },
  QUINELLA: { label: "2+ horses, any order — comma separated", placeholder: "e.g. 1,2,3" },
  EXACTA:   { label: "Pos 1 / Pos 2 — comma = multiple horses per position", placeholder: "e.g. 1,2/3,4" },
  TRIFECTA: { label: "Pos 1 / Pos 2 / Pos 3 — comma = multiple per position", placeholder: "e.g. 1,2/3,4/5,6" },
};

// ── Cost calculation ─────────────────────────────────────────────────────────
// WIN / PLACE:  1 combination → cost = stake
// QUINELLA:     n horses → n×(n−1)/2 combinations (box, any order)
// EXACTA:       pos1_count × pos2_count combinations (part wheel)
// TRIFECTA:     pos1_count × pos2_count × pos3_count combinations

function parseHorseSet(str) {
  if (!str || !str.trim()) return new Set();
  return new Set(str.split(",").map(s => s.trim()).filter(Boolean));
}

function calcCombinations(betType, selection) {
  if (!selection || !selection.trim()) return null;

  switch (betType) {
    case "WIN":
    case "PLACE":
      return 1;

    case "QUINELLA": {
      const n = parseHorseSet(selection).size;
      if (n < 2) return null;
      return (n * (n - 1)) / 2;
    }

    case "EXACTA": {
      const [p1 = "", p2 = ""] = selection.split("/");
      const set1 = parseHorseSet(p1);
      const set2 = parseHorseSet(p2);
      if (!set1.size || !set2.size) return null;
      // each unique (a,b) pair where a≠b
      let combos = 0;
      for (const h1 of set1) for (const h2 of set2) if (h1 !== h2) combos++;
      return combos > 0 ? combos : null;
    }

    case "TRIFECTA": {
      const [p1 = "", p2 = "", p3 = ""] = selection.split("/");
      const set1 = parseHorseSet(p1);
      const set2 = parseHorseSet(p2);
      const set3 = parseHorseSet(p3);
      if (!set1.size || !set2.size || !set3.size) return null;
      // each unique (a,b,c) triple
      let combos = 0;
      for (const h1 of set1)
        for (const h2 of set2)
          for (const h3 of set3)
            if (h1 !== h2 && h1 !== h3 && h2 !== h3) combos++;
      return combos > 0 ? combos : null;
    }

    default:
      return null;
  }
}

function calcCost(betType, selection, stake) {
  const combos = calcCombinations(betType, selection);
  if (combos === null || isNaN(stake) || stake <= 0) return null;
  return parseFloat((combos * stake).toFixed(2));
}

// ── Component ─────────────────────────────────────────────────────────────────

function createEmptyBet(index) {
  return { _key: Date.now() + index, id: index + 1, selection: "", stake: "" };
}

export default function BatchBuilder({ accounts: propAccounts, onBatchCreated }) {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState(propAccounts || []);
  const [accountId, setAccountId] = useState(propAccounts?.[0]?.id ?? "");
  const [betType, setBetType] = useState("WIN");
  const [raceId, setRaceId] = useState("");
  const [bets, setBets] = useState([createEmptyBet(0)]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    if (propAccounts) return;
    getAccounts()
      .then((data) => {
        setAccounts(data);
        if (data.length > 0) setAccountId(data[0].id);
      })
      .catch(() => setError("Failed to load accounts"));
  }, [propAccounts]);

  const addBet = () => setBets((prev) => [...prev, createEmptyBet(prev.length)]);

  const removeBet = (key) =>
    setBets((prev) => {
      const next = prev.filter((b) => b._key !== key);
      return next.length === 0 ? [createEmptyBet(0)] : next;
    });

  const updateBet = (key, field, value) =>
    setBets((prev) => prev.map((b) => (b._key === key ? { ...b, [field]: value } : b)));

  // Derived: cost computed live from selection + stake
  const betsWithCost = bets.map((b) => ({
    ...b,
    combinations: calcCombinations(betType, b.selection),
    cost: calcCost(betType, b.selection, parseFloat(b.stake)),
  }));

  const totalStake = betsWithCost.reduce((s, b) => s + (parseFloat(b.stake) || 0), 0);
  const totalCost  = betsWithCost.reduce((s, b) => s + (b.cost ?? 0), 0);

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    if (!accountId) return setError("Select an account.");
    if (!raceId)    return setError("Enter a race ID.");

    const parsedBets = betsWithCost.map((b, i) => ({
      id: i + 1,
      selection: b.selection.trim(),
      stake: parseFloat(b.stake),
      cost: b.cost,
    }));

    for (const [i, b] of parsedBets.entries()) {
      if (!b.selection)                return setError(`Bet ${i + 1}: selection is required.`);
      if (isNaN(b.stake) || b.stake <= 0) return setError(`Bet ${i + 1}: stake must be > 0.`);
      if (b.cost === null)             return setError(`Bet ${i + 1}: invalid selection for ${betType}.`);
    }

    setSubmitting(true);
    try {
      const payload = {
        meta: { bet_type: betType, race_id: parseInt(raceId) },
        bets: parsedBets,
      };
      const { data } = await axios.post(`${BASE_URL}/${accountId}/batches`, payload);
      if (onBatchCreated) {
        onBatchCreated(data);
        setBets([createEmptyBet(0)]);
        setRaceId("");
        setSuccess(`Batch #${data.id} created with ${data.bets.length} bet(s)!`);
      } else {
        navigate("/");
      }
    } catch (e) {
      setError(e?.response?.data?.message ?? "Failed to create batch.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Styles ────────────────────────────────────────────────────────────────
  const inputStyle = {
    background: "#07080c", border: "1px solid #1c2035", borderRadius: 7,
    color: "#dde1f0", padding: "7px 11px", fontSize: 13,
    fontFamily: "'IBM Plex Mono', monospace", outline: "none", width: "100%",
    boxSizing: "border-box",
  };
  const labelStyle = {
    fontSize: 10, letterSpacing: "1.5px", textTransform: "uppercase",
    color: "#4a5270", marginBottom: 5, display: "block",
  };
  const selectStyle = { ...inputStyle, appearance: "none", cursor: "pointer", paddingRight: 28 };

  return (
    <div style={{
      minHeight: "100vh", background: "#07080c", padding: 28,
      fontFamily: "'IBM Plex Mono', monospace", color: "#dde1f0",
    }}>
      <style>{`input::placeholder { color: #2a3050; }`}</style>
      <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => navigate("/")}
            style={{ background: "none", border: "none", color: "#4a5270", cursor: "pointer", padding: 4, lineHeight: 0 }}
            onMouseEnter={e => e.currentTarget.style.color = "#dde1f0"}
            onMouseLeave={e => e.currentTarget.style.color = "#4a5270"}
            title="Back"
          >
            <ArrowLeft style={{ width: 18, height: 18 }} />
          </button>
          <span style={{ fontWeight: 700, fontSize: 18 }}>Create Batch</span>
        </div>

        <div style={{
          background: "#0e1018", border: "1px solid #1c2035", borderRadius: 12,
          padding: 24, display: "flex", flexDirection: "column", gap: 20,
        }}>

          {/* Top row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 100px", gap: 12 }}>
            <div>
              <label style={labelStyle}>Account</label>
              <div style={{ position: "relative" }}>
                <select style={selectStyle} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <ChevronDown style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 14, color: "#4a5270", pointerEvents: "none" }} />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Bet Type</label>
              <div style={{ position: "relative" }}>
                <select style={selectStyle} value={betType} onChange={(e) => { setBetType(e.target.value); setBets([createEmptyBet(0)]); }}>
                  {BET_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
                <ChevronDown style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 14, color: "#4a5270", pointerEvents: "none" }} />
              </div>
              <div style={{ fontSize: 10, color: "#4a5270", marginTop: 4 }}>{BET_TYPE_HELP[betType].label}</div>
            </div>

            <div>
              <label style={labelStyle}>Race ID</label>
              <input type="number" min={1} style={inputStyle} placeholder="e.g. 3"
                value={raceId} onChange={(e) => setRaceId(e.target.value)} />
            </div>
          </div>

          {/* Bets table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#13161f" }}>
                  {["#", "Selection", "Stake ($)", "Combos", "Cost ($)", ""].map((h) => (
                    <th key={h} style={{
                      padding: "8px 12px", fontSize: 10, letterSpacing: "1.5px",
                      textTransform: "uppercase", color: "#4a5270", fontWeight: 500,
                      borderBottom: "1px solid #1c2035",
                      textAlign: ["#", "Combos", "Cost ($)"].includes(h) ? "center" : "left",
                      whiteSpace: "nowrap",
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {betsWithCost.map((bet, i) => (
                  <tr key={bet._key} style={{ borderBottom: "1px solid #1c2035" }}>
                    <td style={{ padding: "8px 12px", color: "#4a5270", textAlign: "center", width: 32 }}>{i + 1}</td>

                    <td style={{ padding: "6px 8px" }}>
                      <input
                        style={inputStyle}
                        placeholder={BET_TYPE_HELP[betType].placeholder}
                        value={bet.selection}
                        onChange={(e) => updateBet(bet._key, "selection", e.target.value)}
                      />
                    </td>

                    <td style={{ padding: "6px 8px", width: 110 }}>
                      <input
                        type="number" min={0} step={0.5} style={inputStyle} placeholder="0.00"
                        value={bet.stake}
                        onChange={(e) => updateBet(bet._key, "stake", e.target.value)}
                      />
                    </td>

                    <td style={{ padding: "8px 12px", textAlign: "center", width: 80 }}>
                      {bet.combinations !== null
                        ? <span style={{ color: "#f5a623", fontWeight: 600 }}>{bet.combinations}</span>
                        : <span style={{ color: "#4a5270" }}>—</span>}
                    </td>

                    <td style={{ padding: "8px 12px", textAlign: "center", width: 110 }}>
                      {bet.cost !== null
                        ? <span style={{ color: "#86efac", fontWeight: 600 }}>${bet.cost.toFixed(2)}</span>
                        : <span style={{ color: "#4a5270" }}>—</span>}
                    </td>

                    <td style={{ padding: "6px 8px", width: 36, textAlign: "center" }}>
                      <button onClick={() => removeBet(bet._key)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#4a5270", padding: 4, lineHeight: 0 }}
                        onMouseEnter={e => e.currentTarget.style.color = "#ef4444"}
                        onMouseLeave={e => e.currentTarget.style.color = "#4a5270"}
                        title="Remove"
                      >
                        <Trash2 style={{ width: 15, height: 15 }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add bet */}
          <button onClick={addBet} style={{
            background: "transparent", border: "1px dashed #1c2035", borderRadius: 8,
            color: "#4a5270", padding: "8px 16px", cursor: "pointer", fontSize: 12,
            fontFamily: "inherit", display: "flex", alignItems: "center",
            justifyContent: "center", gap: 6, transition: "all .15s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#f5a623"; e.currentTarget.style.color = "#f5a623"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#1c2035"; e.currentTarget.style.color = "#4a5270"; }}
          >
            <Plus style={{ width: 14 }} /> Add Bet
          </button>

          {/* Summary */}
          <div style={{ display: "flex", gap: 24, fontSize: 12, color: "#8891b0",
            borderTop: "1px solid #1c2035", paddingTop: 14 }}>
            <span>Bets: <strong style={{ color: "#dde1f0" }}>{bets.length}</strong></span>
            <span>Total Stake: <strong style={{ color: "#dde1f0" }}>${totalStake.toFixed(2)}</strong></span>
            <span>Total Cost: <strong style={{ color: "#86efac" }}>${totalCost.toFixed(2)}</strong></span>
          </div>

          {/* Feedback */}
          {error && (
            <div style={{ background: "#2d0a0a", border: "1px solid #7f1d1d",
              borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 13 }}>
              ✗ {error}
            </div>
          )}
          {success && (
            <div style={{ background: "#052e16", border: "1px solid #166534",
              borderRadius: 8, padding: "10px 14px", color: "#86efac", fontSize: 13 }}>
              ✓ {success}
            </div>
          )}

          {/* Submit */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={handleSubmit} disabled={submitting} style={{
              background: submitting ? "#4a5270" : "#f5a623",
              color: submitting ? "#dde1f0" : "#000",
              border: "none", padding: "10px 24px", borderRadius: 8,
              cursor: submitting ? "not-allowed" : "pointer",
              fontFamily: "inherit", fontSize: 13, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 8, transition: "background .15s",
            }}
              onMouseEnter={e => { if (!submitting) e.currentTarget.style.background = "#f7ba4a"; }}
              onMouseLeave={e => { if (!submitting) e.currentTarget.style.background = submitting ? "#4a5270" : "#f5a623"; }}
            >
              <Send style={{ width: 14 }} />
              {submitting ? "Sending…" : "Send Batch"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
