import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { consumeOAuthRedirect } from "./api";
import "./styles.css";

consumeOAuthRedirect();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
