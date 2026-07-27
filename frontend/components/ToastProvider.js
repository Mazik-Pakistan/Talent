"use client";

import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

export default function ToastProvider() {
  return (
    <ToastContainer
      position="top-right"
      autoClose={4200}
      hideProgressBar={false}
      newestOnTop
      closeOnClick
      pauseOnHover
      draggable
      theme="colored"
      limit={4}
      style={{ zIndex: 10050 }}
      toastStyle={{
        zIndex: 10050,
        fontFamily: "inherit",
        fontSize: "14px",
        fontWeight: 600,
        borderRadius: "12px",
        boxShadow: "0 12px 40px rgba(15, 42, 74, 0.22)",
      }}
    />
  );
}
