package main

import "encoding/json"

// controlFile is the discovery file bump writes to $BUMP_DIR/control.json.
type controlFile struct {
	Port      int    `json:"port"`
	Token     string `json:"token"`
	Pid       int    `json:"pid"`
	StartedAt string `json:"startedAt"`
}

// envelope is the response shape every endpoint returns.
type envelope struct {
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data"`
	Error string          `json:"error"`
}

type statusData struct {
	Version        string `json:"version"`
	Pid            int    `json:"pid"`
	TerminalCount  int    `json:"terminalCount"`
	WorkspaceCount int    `json:"workspaceCount"`
	UptimeMs       int64  `json:"uptimeMs"`
}

type terminalData struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Pid         *int    `json:"pid"`
	Cwd         *string `json:"cwd"`
	GitBranch   *string `json:"gitBranch"`
	LogPath     string  `json:"logPath"`
	WorkspaceID *string `json:"workspaceId"`
	PaneID      *string `json:"paneId"`
}

type terminalsData struct {
	Terminals []terminalData `json:"terminals"`
}

type paneInfo struct {
	PaneID     string  `json:"paneId"`
	TerminalID *string `json:"terminalId"`
}

type paneNode struct {
	Type      string     `json:"type"`
	PaneID    string     `json:"paneId,omitempty"`
	ID        string     `json:"id,omitempty"`
	Direction string     `json:"direction,omitempty"`
	Children  []paneNode `json:"children,omitempty"`
	Sizes     []float64  `json:"sizes,omitempty"`
}

type workspaceData struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	IsActive     bool       `json:"isActive"`
	ActivePaneID string     `json:"activePaneId"`
	PaneTree     paneNode   `json:"paneTree"`
	Panes        []paneInfo `json:"panes"`
}

type workspacesData struct {
	Workspaces        []workspaceData `json:"workspaces"`
	ActiveWorkspaceID *string         `json:"activeWorkspaceId"`
}

type bufferData struct {
	ID     string `json:"id"`
	Lines  *int   `json:"lines"`
	Buffer string `json:"buffer"`
}

// mutationResult covers the various create/split/run/close responses. Fields
// are populated selectively depending on the endpoint.
type mutationResult struct {
	ID          string `json:"id"`
	TerminalID  string `json:"terminalId"`
	PaneID      string `json:"paneId"`
	WorkspaceID string `json:"workspaceId"`
	Command     string `json:"command"`
	Closed      bool   `json:"closed"`
}
