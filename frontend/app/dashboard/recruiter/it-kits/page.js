"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import RecruiterShell from "@/components/recruiter/RecruiterShell";
import RecruiterLoader from "@/components/recruiter/RecruiterLoader";
import ProtectedRecruiterRoute from "@/components/ProtectedRecruiterRoute";
import ConfirmDialog from "@/components/ConfirmDialog";
import { readAuth } from "@/components/ai/AgentChatCore";
import styles from "@/components/recruiter/recruiter-shell.module.css";
import {
  createItKit,
  deleteItKit,
  getApiErrorMessage,
  listItKits,
  updateItKit,
} from "@/services/authService";

const ASSET_TYPES = [
  { value: "laptop", label: "Laptop" },
  { value: "monitor", label: "Monitor" },
  { value: "phone", label: "Phone" },
  { value: "headset", label: "Headset" },
  { value: "badge", label: "Badge" },
  { value: "license", label: "Software license" },
  { value: "other", label: "Other" },
];

const emptyAsset = () => ({ name: "", asset_type: "laptop", serial_number: "", notes: "" });
const emptyLicense = () => ({ name: "", vendor: "", notes: "" });

export default function RecruiterItKitsPage() {
  return (
    <ProtectedRecruiterRoute requiredCapability="it">
      <RecruiterItKitsPageContent />
    </ProtectedRecruiterRoute>
  );
}

function RecruiterItKitsPageContent() {
  const [auth] = useState(() => readAuth());
  const [kits, setKits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    roles: "",
    is_default: false,
    assets: [emptyAsset()],
    licenses: [emptyLicense()],
  });

  const loadKits = useCallback(async () => {
    const token = localStorage.getItem("access_token");
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const data = await listItKits(token);
      setKits(data.kits || []);
    } catch (err) {
      setError(getApiErrorMessage(err, "Could not load IT kits."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (auth) loadKits();
  }, [auth, loadKits]);

  function openCreate() {
    setEditingId(null);
    setForm({
      name: "",
      description: "",
      roles: "",
      is_default: false,
      assets: [emptyAsset()],
      licenses: [emptyLicense()],
    });
    setShowForm(true);
  }

  function openEdit(kit) {
    setEditingId(kit.kit_id);
    setForm({
      name: kit.name || "",
      description: kit.description || "",
      roles: (kit.roles || []).join(", "),
      is_default: Boolean(kit.is_default),
      assets: (kit.assets || []).length
        ? (kit.assets || []).map((a) => ({
            name: a.name || "",
            asset_type: a.asset_type || "laptop",
            serial_number: a.serial_number || "",
            notes: a.notes || "",
          }))
        : [emptyAsset()],
      licenses: (kit.licenses || []).length
        ? (kit.licenses || []).map((l) => ({
            name: l.name || "",
            vendor: l.vendor || "",
            notes: l.notes || "",
          }))
        : [emptyLicense()],
    });
    setShowForm(true);
  }

  function updateAsset(i, patch) {
    setForm((f) => ({
      ...f,
      assets: f.assets.map((a, idx) => (idx === i ? { ...a, ...patch } : a)),
    }));
  }

  function updateLicense(i, patch) {
    setForm((f) => ({
      ...f,
      licenses: f.licenses.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    }));
  }

  async function handleSave() {
    const token = localStorage.getItem("access_token");
    if (!token || saving) return;
    const name = form.name.trim();
    if (!name) {
      toast.error("Give the kit a name.");
      return;
    }
    const assets = form.assets
      .filter((a) => a.name.trim())
      .map((a) => ({
        name: a.name.trim(),
        asset_type: a.asset_type,
        serial_number: a.serial_number.trim() || undefined,
        notes: a.notes.trim() || undefined,
      }));
    const licenses = form.licenses
      .filter((l) => l.name.trim())
      .map((l) => ({
        name: l.name.trim(),
        vendor: l.vendor.trim() || undefined,
        notes: l.notes.trim() || undefined,
      }));
    if (!assets.length && !licenses.length) {
      toast.error("Add at least one asset or software license.");
      return;
    }
    const payload = {
      name,
      description: form.description.trim() || undefined,
      roles: form.roles
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean),
      is_default: form.is_default,
      assets,
      licenses,
    };
    setSaving(true);
    try {
      if (editingId) {
        await updateItKit(editingId, payload, token);
        toast.success("IT kit updated.");
      } else {
        await createItKit(payload, token);
        toast.success("IT kit created.");
      }
      setShowForm(false);
      await loadKits();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not save the IT kit."));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const token = localStorage.getItem("access_token");
    if (!token || !deleteTarget) return;
    try {
      await deleteItKit(deleteTarget.kit_id, token);
      toast.success("IT kit deleted.");
      setDeleteTarget(null);
      await loadKits();
    } catch (err) {
      toast.error(getApiErrorMessage(err, "Could not delete the IT kit."));
      setDeleteTarget(null);
    }
  }

  return (
    <RecruiterShell>
      <div className={styles.content}>
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.sectionHeadLeft}>
              <div className={`${styles.bar} ${styles.green}`} />
              <div>
                <div className={styles.sectionTitle}>IT kits</div>
                <div className={styles.sectionDesc}>
                  Reusable standard setups (assets + software licenses) IT applies when provisioning new
                  hires. These power the bulk IT provisioning form.
                </div>
              </div>
            </div>
            <button type="button" className={styles.primaryButton} onClick={openCreate}>
              New kit
            </button>
          </div>

          <div className={styles.sectionBody}>
            {error && (
              <p style={{ color: "var(--danger, #c0392b)", marginBottom: 12 }}>{error}</p>
            )}
            {loading ? (
              <RecruiterLoader />
            ) : kits.length === 0 ? (
              <p className={styles.emptySub}>
                No IT kits yet. Create one to standardize new-hire setups.
              </p>
            ) : (
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
                {kits.map((kit) => (
                  <div
                    key={kit.kit_id}
                    style={{
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      padding: 16,
                      background: "#fff",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                      <div>
                        <strong style={{ fontSize: 15 }}>{kit.name}</strong>
                        {kit.is_default && (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 11,
                              fontWeight: 700,
                              color: "#0d5c91",
                              background: "#e7f1f9",
                              padding: "2px 8px",
                              borderRadius: 999,
                            }}
                          >
                            default
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => openEdit(kit)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => setDeleteTarget(kit)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {kit.description && (
                      <p style={{ margin: "6px 0", fontSize: 13, color: "#556" }}>{kit.description}</p>
                    )}
                    {kit.roles && kit.roles.length > 0 && (
                      <p style={{ margin: "6px 0", fontSize: 12, color: "#6b7a8f" }}>
                        Roles: {kit.roles.join(", ")}
                      </p>
                    )}
                    <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>
                        Assets ({kit.assets?.length || 0})
                      </div>
                      {(kit.assets || []).length ? (
                        (kit.assets || []).map((a, i) => (
                          <div key={i}>
                            • {a.name}
                            {a.serial_number ? ` (${a.serial_number})` : ""}
                          </div>
                        ))
                      ) : (
                        <div style={{ color: "#999" }}>—</div>
                      )}
                      <div style={{ fontWeight: 600, marginTop: 6, marginBottom: 2 }}>
                        Licenses ({kit.licenses?.length || 0})
                      </div>
                      {(kit.licenses || []).length ? (
                        (kit.licenses || []).map((l, i) => (
                          <div key={i}>
                            • {l.name}
                            {l.vendor ? ` — ${l.vendor}` : ""}
                          </div>
                        ))
                      ) : (
                        <div style={{ color: "#999" }}>—</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showForm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,25,45,0.45)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "40px 16px",
            zIndex: 60,
            overflow: "auto",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 16,
              width: "min(100%, 680px)",
              padding: 24,
            }}
          >
            <h3 style={{ margin: "0 0 16px" }}>
              {editingId ? "Edit IT kit" : "New IT kit"}
            </h3>

            <label className={styles.field}>
              <span className={styles.label}>Name</span>
              <input
                className={styles.input}
                name="kit_name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Engineer Standard"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Description</span>
              <input
                className={styles.input}
                name="kit_description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Standard setup for engineering roles"
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Roles (comma separated)</span>
              <input
                className={styles.input}
                name="kit_roles"
                value={form.roles}
                onChange={(e) => setForm((f) => ({ ...f, roles: e.target.value }))}
                placeholder="Engineer, Developer, SDE"
              />
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 16px" }}>
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))}
              />
              <span style={{ fontSize: 14 }}>Mark as default kit</span>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Assets</span>
              {form.assets.map((asset, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <input
                    className={styles.input}
                    style={{ flex: 1, minWidth: 140 }}
                    value={asset.name}
                    onChange={(e) => updateAsset(i, { name: e.target.value })}
                    placeholder="Asset name (e.g. MacBook Pro 14)"
                  />
                  <select
                    className={styles.input}
                    style={{ width: 150 }}
                    value={asset.asset_type}
                    onChange={(e) => updateAsset(i, { asset_type: e.target.value })}
                  >
                    {ASSET_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className={styles.input}
                    style={{ width: 120 }}
                    value={asset.serial_number}
                    onChange={(e) => updateAsset(i, { serial_number: e.target.value })}
                    placeholder="Serial #"
                  />
                  {form.assets.length > 1 && (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() =>
                        setForm((f) => ({ ...f, assets: f.assets.filter((_, idx) => idx !== i) }))
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setForm((f) => ({ ...f, assets: [...f.assets, emptyAsset()] }))}
              >
                + Add asset
              </button>
            </div>

            <div className={styles.field}>
              <span className={styles.label}>Licenses</span>
              {form.licenses.map((lic, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <input
                    className={styles.input}
                    style={{ flex: 1, minWidth: 140 }}
                    value={lic.name}
                    onChange={(e) => updateLicense(i, { name: e.target.value })}
                    placeholder="License name (e.g. VS Code Pro)"
                  />
                  <input
                    className={styles.input}
                    style={{ width: 150 }}
                    value={lic.vendor}
                    onChange={(e) => updateLicense(i, { vendor: e.target.value })}
                    placeholder="Vendor"
                  />
                  {form.licenses.length > 1 && (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          licenses: f.licenses.filter((_, idx) => idx !== i),
                        }))
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setForm((f) => ({ ...f, licenses: [...f.licenses, emptyLicense()] }))}
              >
                + Add license
              </button>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 20 }}>
              <button type="button" className={styles.secondaryButton} onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button type="button" className={styles.primaryButton} disabled={saving} onClick={handleSave}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Create kit"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete IT kit"
        message={`Delete "${deleteTarget?.name}"? Kits already used in requests are kept on those requests.`}
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </RecruiterShell>
  );
}
