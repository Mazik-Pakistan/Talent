"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import RequireAccess from "@/components/RequireAccess";
import DocumentManager from "@/components/DocumentManager";

export default function DocumentsPage() {
  const router = useRouter();
  const [user] = useState(() => {
    if (typeof window === "undefined") return null;
    try {
      return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
      return null;
    }
  });

  if (!user) return <p style={{ textAlign: "center", marginTop: "2rem" }}>Loading…</p>;

  return (
    <RequireAccess anyOf={["documents.self", "profile.view"]} roles={["candidate", "employee"]}>
      <div style={{ minHeight: "100vh", background: "#f6f9fb", padding: "28px 20px 60px" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ color: "#32a6ae", fontSize: 12, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" }}>
                Document centre
              </div>
              <h1 style={{ margin: "4px 0 0", fontSize: "2rem", color: "#123a63" }}>My documents</h1>
              <p style={{ margin: "6px 0 0", color: "#5c7086" }}>
                Organize your files into categories, download them whenever needed, and upload updates from one place.
              </p>
            </div>
            <button type="button" className="secondary-button" onClick={() => router.back()}>
              Back
            </button>
          </div>
          <DocumentManager compact={false} />
        </div>
      </div>
    </RequireAccess>
  );
}
