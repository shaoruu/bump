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
	ID          string      `json:"id"`
	Title       string      `json:"title"`
	Pid         *int        `json:"pid"`
	Cwd         *string     `json:"cwd"`
	GitBranch   *string     `json:"gitBranch"`
	LogPath     string      `json:"logPath"`
	WorkspaceID *string     `json:"workspaceId"`
	PaneID      *string     `json:"paneId"`
	Job         *jobSummary `json:"job"`
}

type terminalsData struct {
	Terminals []terminalData `json:"terminals"`
}

// jobSummary is the compact job view embedded in each terminal listing.
type jobSummary struct {
	Status         string  `json:"status"`
	CurrentCommand *string `json:"currentCommand"`
	LastExitCode   *int    `json:"lastExitCode"`
}

// jobState is the full per-terminal job returned by /terminals/:id/job.
type jobState struct {
	ID             string  `json:"id"`
	Status         string  `json:"status"`
	CurrentCommand *string `json:"currentCommand"`
	LastCommand    *string `json:"lastCommand"`
	LastExitCode   *int    `json:"lastExitCode"`
	StartedAt      *int64  `json:"startedAt"`
	EndedAt        *int64  `json:"endedAt"`
	CommandCount   int     `json:"commandCount"`
}

type runningJob struct {
	ID        string  `json:"id"`
	Command   *string `json:"command"`
	CommandID int     `json:"commandId"`
	StartedAt *int64  `json:"startedAt"`
	ElapsedMs *int64  `json:"elapsedMs"`
}

type jobsData struct {
	Jobs []runningJob `json:"jobs"`
}

// runWaitData is returned by POST /terminals/:id/run with { wait: true }.
type runWaitData struct {
	ID         string `json:"id"`
	Command    string `json:"command"`
	ExitCode   *int   `json:"exitCode"`
	DurationMs *int64 `json:"durationMs"`
	CommandID  int    `json:"commandId"`
}

// commandEvent is one Server-Sent Event from /events.
type commandEvent struct {
	Type       string `json:"type"`
	TerminalID string `json:"terminalId"`
	CommandID  int    `json:"commandId"`
	Command    string `json:"command"`
	ExitCode   *int   `json:"exitCode"`
	StartedAt  *int64 `json:"startedAt"`
	EndedAt    *int64 `json:"endedAt"`
	DurationMs *int64 `json:"durationMs"`
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
	IsEphemeral  bool       `json:"isEphemeral"`
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

// cleanData is returned by POST /workspaces/clean.
type cleanData struct {
	ClosedWorkspaceIDs []string `json:"closedWorkspaceIds"`
}
