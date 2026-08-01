"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-toastify";

import { getNotifications, markNotificationsRead } from "@/services/authService";

const DEFAULT_POLL_MS = 20000;

function broadcast(unreadCount, notifications) {
  window.dispatchEvent(
    new CustomEvent("talent-notifications-updated", {
      detail: { unreadCount, notifications },
    })
  );
}

/**
 * Notification bell state + polling, shared by the recruiter, employee, and
 * candidate shells. Each shell previously hand-rolled this with small
 * behavioral differences (toast dedup id, extra side effects on a new
 * notification, whether reads are broadcast to other components). Those
 * differences are reproduced exactly via options so switching a shell over
 * to this hook changes nothing the user can see.
 *
 * @param {object} options
 * @param {number} [options.pollMs]
 * @param {number} [options.limit] passed straight through to getNotifications
 * @param {string} [options.toastIdPrefix] enables toast dedup, e.g. "recruiter-notif"
 * @param {(newest: object) => void} [options.onNewNotification] extra side effect fired once per newly-seen notification (e.g. AI copilot bubble)
 * @param {boolean} [options.broadcastOnRefresh]
 * @param {boolean} [options.broadcastOnMarkAll]
 * @param {boolean} [options.broadcastOnMarkOne]
 */
export function useNotificationsCenter({
  pollMs = DEFAULT_POLL_MS,
  limit,
  toastIdPrefix,
  onNewNotification,
  broadcastOnRefresh = false,
  broadcastOnMarkAll = false,
  broadcastOnMarkOne = false,
} = {}) {
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifBusy, setNotifBusy] = useState(false);
  const lastUnreadRef = useRef(null);

  const refresh = useCallback(
    async (silent = true) => {
      const accessToken = localStorage.getItem("access_token");
      if (!accessToken) return;
      try {
        const data = await getNotifications(accessToken, limit);
        const nextUnread = data.unread_count || 0;
        const nextList = data.notifications || [];
        const grew =
          silent && lastUnreadRef.current != null && nextUnread > lastUnreadRef.current && nextList[0];

        if (grew) {
          const newest = nextList[0];
          if (toastIdPrefix) {
            toast.info(`${newest.title}: ${newest.message?.slice(0, 100) || "New notification"}`, {
              toastId: `${toastIdPrefix}-${newest.id || newest.title}`,
            });
          } else {
            toast.info(newest.title || "New notification");
          }
          onNewNotification?.(newest);
        }

        lastUnreadRef.current = nextUnread;
        setNotifications(nextList);
        setUnreadCount(nextUnread);
        if (broadcastOnRefresh) broadcast(nextUnread, nextList);
      } catch {
        // Non-critical polling failure
      }
    },
    // Intentionally excludes callback props so identity churn from the
    // caller doesn't restart polling; matches the original hooks' behavior.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [limit, toastIdPrefix, broadcastOnRefresh]
  );

  useEffect(() => {
    refresh(false);
    const timer = setInterval(() => refresh(true), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  const markAllRead = useCallback(async () => {
    const accessToken = localStorage.getItem("access_token");
    if (!accessToken || unreadCount === 0) return;
    setNotifBusy(true);
    try {
      await markNotificationsRead({ all: true }, accessToken);
      setNotifications((current) => {
        const nextList = current.map((n) => ({ ...n, read: true }));
        if (broadcastOnMarkAll) broadcast(0, nextList);
        return nextList;
      });
      setUnreadCount(0);
      lastUnreadRef.current = 0;
      toast.success("All notifications marked as read.");
    } catch {
      toast.error("Could not update notifications.");
    } finally {
      setNotifBusy(false);
    }
  }, [unreadCount, broadcastOnMarkAll]);

  const markOneRead = useCallback(
    async (notificationId) => {
      const accessToken = localStorage.getItem("access_token");
      if (!accessToken) return;
      try {
        await markNotificationsRead({ ids: [notificationId], all: false }, accessToken);
        let updatedList = [];
        setNotifications((current) => {
          updatedList = current.map((n) => (n.id === notificationId ? { ...n, read: true } : n));
          return updatedList;
        });
        setUnreadCount((count) => {
          const next = Math.max(0, count - 1);
          lastUnreadRef.current = next;
          if (broadcastOnMarkOne) broadcast(next, updatedList);
          return next;
        });
      } catch {
        // Navigation remains available even if read-state persistence fails.
      }
    },
    [broadcastOnMarkOne]
  );

  return {
    notifOpen,
    setNotifOpen,
    notifications,
    unreadCount,
    notifBusy,
    markAllRead,
    markOneRead,
    refresh,
  };
}
