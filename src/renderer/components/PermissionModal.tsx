import { useAppStore } from "../store/appStore.js";

export function PermissionModal() {
  const pendingPermission = useAppStore((s) => s.pendingPermission);
  const setPendingPermission = useAppStore((s) => s.setPendingPermission);

  if (!pendingPermission) return null;

  const handleOption = (optionId: string) => {
    window.bump.respondToPermission({
      outcome: { outcome: "selected", optionId },
    });
    setPendingPermission(null);
  };

  const handleCancel = () => {
    window.bump.respondToPermission({
      outcome: { outcome: "cancelled" },
    });
    setPendingPermission(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-1 border border-border rounded-lg p-4 max-w-md w-full mx-4">
        <p className="text-sm text-text-primary mb-1">
          Permission requested
        </p>
        <p className="text-xs text-text-secondary mb-4">
          {pendingPermission.toolCall.title}
        </p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={handleCancel}
            className="text-xs text-text-secondary px-3 py-1.5 rounded hover:bg-surface-2 transition-colors"
          >
            cancel
          </button>
          {pendingPermission.options.map((opt) => (
            <button
              key={opt.optionId}
              onClick={() => handleOption(opt.optionId)}
              className={`text-xs px-3 py-1.5 rounded transition-colors ${
                opt.kind === "reject_once"
                  ? "text-red-400 hover:bg-red-500/10"
                  : "text-accent bg-accent/10 hover:bg-accent/20"
              }`}
            >
              {opt.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
