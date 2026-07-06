package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"text/tabwriter"
	"time"
)

func printJSON(data json.RawMessage) error {
	if len(data) == 0 {
		fmt.Println("null")
		return nil
	}
	var buf bytes.Buffer
	if err := json.Indent(&buf, data, "", "  "); err != nil {
		fmt.Println(string(data))
		return nil
	}
	fmt.Println(buf.String())
	return nil
}

func printJSONValue(v any) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return printJSON(raw)
}

// jobStatusLabel renders a terminal's job for the ls STATUS column: running,
// idle, a non-zero "exit N", or "-" when shell integration is not reporting.
func jobStatusLabel(j *jobSummary) string {
	if j == nil || j.Status == "" || j.Status == "unknown" {
		return "-"
	}
	if j.Status == "running" {
		return "running"
	}
	if j.LastExitCode != nil && *j.LastExitCode != 0 {
		return fmt.Sprintf("exit %d", *j.LastExitCode)
	}
	return "idle"
}

func printWatchEvent(ev commandEvent) {
	ts := time.Now().Format("15:04:05")
	switch ev.Type {
	case "command_start":
		fmt.Printf("%s  %s  RUN   %s\n", ts, ev.TerminalID, ev.Command)
	case "command_end":
		dur := ""
		if ev.DurationMs != nil {
			dur = " (" + formatElapsed(*ev.DurationMs) + ")"
		}
		if ev.ExitCode != nil && *ev.ExitCode != 0 {
			fmt.Printf("%s  %s  FAIL  %s [exit %d]%s\n", ts, ev.TerminalID, ev.Command, *ev.ExitCode, dur)
		} else {
			fmt.Printf("%s  %s  DONE  %s%s\n", ts, ev.TerminalID, ev.Command, dur)
		}
	}
}

func strOr(p *string, fallback string) string {
	if p == nil || *p == "" {
		return fallback
	}
	return *p
}

func intOr(p *int, fallback string) string {
	if p == nil {
		return fallback
	}
	return strconv.Itoa(*p)
}

func truncate(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	if max <= 1 {
		return string(runes[:max])
	}
	return string(runes[:max-1]) + "…"
}

func shortHome(path string) string {
	if path == "" {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return path
	}
	if path == home {
		return "~"
	}
	if strings.HasPrefix(path, home+string(filepath.Separator)) {
		return "~" + path[len(home):]
	}
	return path
}

func formatDuration(ms int64) string {
	return (time.Duration(ms) * time.Millisecond).Round(time.Second).String()
}

// formatElapsed keeps sub-second precision for short command durations while
// rounding longer ones to whole seconds.
func formatElapsed(ms int64) string {
	d := time.Duration(ms) * time.Millisecond
	if d < time.Minute {
		return d.Round(10 * time.Millisecond).String()
	}
	return d.Round(time.Second).String()
}

func newTable() *tabwriter.Writer {
	return tabwriter.NewWriter(os.Stdout, 0, 2, 2, ' ', 0)
}
