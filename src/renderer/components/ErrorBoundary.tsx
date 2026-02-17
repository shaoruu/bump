import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  private handleCopy = () => {
    const { error } = this.state;
    if (!error) return;

    const text = [error.message, "", error.stack ?? ""].join("\n").trim();
    navigator.clipboard.writeText(text).then(() => {
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    });
  };

  private handleReload = () => {
    this.setState({ error: null, copied: false });
  };

  render() {
    const { error, copied } = this.state;

    if (error) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[520px] max-h-[80vh] flex flex-col bg-surface-1 border border-white/[0.08] shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
              <span className="text-sm font-medium text-text-primary">
                something went wrong
              </span>
              <button
                onClick={this.handleReload}
                className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
              >
                dismiss
              </button>
            </div>

            <div className="px-4 py-3 border-b border-white/[0.06]">
              <p className="text-sm text-red-400 break-words">{error.message}</p>
            </div>

            {error.stack && (
              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
                <pre className="text-2xs text-text-tertiary whitespace-pre-wrap break-all leading-relaxed font-mono">
                  {error.stack}
                </pre>
              </div>
            )}

            <div className="flex justify-end gap-2 px-4 py-3 border-t border-white/[0.06]">
              <button
                onClick={this.handleCopy}
                className="text-xs text-text-secondary px-3 py-1.5 hover:bg-surface-2 transition-colors"
              >
                {copied ? "copied!" : "copy error"}
              </button>
              <button
                onClick={this.handleReload}
                className="text-xs text-accent bg-accent/10 px-3 py-1.5 hover:bg-accent/20 transition-colors"
              >
                try again
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
