"use client";

import { ChevronsLeft, ChevronsRight } from "lucide-react";
import styles from "./talent.module.css";

/**
 * Compact pager for Talent lists. Works with server or client pagination.
 */
export default function ListPager({
  page = 1,
  pages = 1,
  total = null,
  pageSize = null,
  loading = false,
  onPageChange,
  label = "records",
}) {
  if (!pages || pages <= 1) {
    if (total == null) return null;
    return (
      <div className={styles.listPager}>
        <span className={styles.listPagerMeta}>
          {total} {label}
        </span>
      </div>
    );
  }

  const from = pageSize ? (page - 1) * pageSize + 1 : null;
  const to = pageSize && total != null ? Math.min(page * pageSize, total) : null;

  return (
    <div className={styles.listPager}>
      <button
        type="button"
        className={styles.pageBtn}
        disabled={loading || page <= 1}
        onClick={() => onPageChange?.(page - 1)}
      >
        <ChevronsLeft size={14} aria-hidden="true" /> Previous
      </button>
      <span className={styles.listPagerMeta}>
        Page {page} of {pages}
        {from != null && to != null && total != null
          ? ` · ${from}–${to} of ${total} ${label}`
          : total != null
            ? ` · ${total} ${label}`
            : ""}
      </span>
      <button
        type="button"
        className={styles.pageBtn}
        disabled={loading || page >= pages}
        onClick={() => onPageChange?.(page + 1)}
      >
        Next <ChevronsRight size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

export function paginateLocal(items, page, pageSize) {
  const list = Array.isArray(items) ? items : [];
  const pages = Math.max(1, Math.ceil(list.length / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), pages);
  const start = (safePage - 1) * pageSize;
  return {
    page: safePage,
    pages,
    total: list.length,
    items: list.slice(start, start + pageSize),
  };
}
