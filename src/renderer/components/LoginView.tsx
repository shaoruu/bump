import { useState } from "react";

interface LoginViewProps {
  onRefresh: () => Promise<void>;
}

export function LoginView({ onRefresh }: LoginViewProps) {
  const [loading, setLoading] = useState(false);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      await onRefresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex items-center justify-center bg-surface-0">
      <div className="titlebar-drag absolute inset-x-0 top-0 h-[32px]" />
      <div className="flex flex-col items-center gap-5 w-72">
        <div className="text-center">
          <h1 className="text-lg font-medium text-text-primary">bump</h1>
          <p className="mt-2 text-xs text-text-secondary leading-relaxed">
            run{" "}
            <span className="text-text-primary bg-surface-2 px-1.5 py-0.5">
              cursor-agent login
            </span>{" "}
            in your terminal, then hit refresh
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="titlebar-no-drag w-full bg-text-primary px-4 py-2 text-sm font-medium text-surface-0 transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "checking..." : "refresh"}
        </button>
      </div>
    </div>
  );
}
