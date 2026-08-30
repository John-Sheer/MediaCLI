import React from "react";
import { detectBuildTag } from "./lib/buildTag.js";
import { reportError } from "./lib/errlog.js";

const BUILD = detectBuildTag();

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("App crash:", error, info);
    reportError("boundary", error);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, color: "#fff", fontFamily: "monospace", background: "#1a0000", minHeight: "100vh" }}>
          <h2 style={{ color: "#ff3b5c" }}>ERREUR DE RENDU — build {BUILD || "?"}</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#ffb3b3" }}>
            {String(this.state.error?.stack || this.state.error)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
