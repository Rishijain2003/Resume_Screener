"use client";

import { Toaster } from "sonner";

export function ToasterHost() {
  return (
    <Toaster
      theme="dark"
      richColors
      position="top-center"
      closeButton
      expand
      duration={6500}
      style={{ zIndex: 200 }}
      toastOptions={{
        classNames: {
          toast: "bg-slate-900/95 backdrop-blur-md border-slate-600/80 text-slate-100 shadow-xl",
          title: "text-slate-50",
          description: "text-slate-300",
          closeButton: "text-slate-400 hover:text-slate-100 bg-slate-800 border-slate-600",
        },
      }}
    />
  );
}
