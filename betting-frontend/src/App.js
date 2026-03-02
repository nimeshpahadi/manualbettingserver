import React from "react";
import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import AccountList from "./components/AccountList";
import BatchBuilder from "./components/BatchBuilder";

const link = document.createElement("link");
link.rel = "stylesheet";
link.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap";
document.head.appendChild(link);

const navStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 20px",
  background: "#0e1018",
  borderBottom: "1px solid #1c2035",
  fontFamily: "'IBM Plex Mono', monospace",
};

const linkStyle = ({ isActive }) => ({
  color: isActive ? "#f5a623" : "#8891b0",
  textDecoration: "none",
  fontSize: 13,
  padding: "5px 12px",
  borderRadius: 7,
  border: `1px solid ${isActive ? "#f5a623" : "transparent"}`,
  background: isActive ? "rgba(245,166,35,0.10)" : "transparent",
  transition: "all .15s",
});

function Nav() {
  return (
    <nav style={navStyle}>
      <span style={{ color: "#4a5270", fontSize: 13, marginRight: 8 }}>🎲 Betstream</span>
      <NavLink to="/" end style={linkStyle}>Batches</NavLink>
      <NavLink to="/create" style={linkStyle}>+ Create Batch</NavLink>
    </nav>
  );
}

function App() {
  return (
    <BrowserRouter>
      <div style={{ minHeight: "100vh", background: "#07080c" }}>
        <Nav />
        <Routes>
          <Route path="/" element={<AccountList />} />
          <Route path="/create" element={<BatchBuilder />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
