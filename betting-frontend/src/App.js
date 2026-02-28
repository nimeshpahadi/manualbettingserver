import React from "react";
import AccountList from "./components/AccountList";

const link = document.createElement("link");
link.rel = "stylesheet";
link.href = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap";
document.head.appendChild(link);

function App() {
  return <AccountList />;
}

export default App;
