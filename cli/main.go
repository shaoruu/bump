package main

import (
	"errors"
	"fmt"
	"os"
)

// Distinct exit codes so scripts and agents can branch on the failure mode.
const (
	exitGeneric    = 1
	exitNotRunning = 2
	exitBusy       = 3
	exitUnknownID  = 4
	exitTimeout    = 124
)

// exitError lets a command choose the process exit code (and, when msg is
// empty, exit silently -- used by `run --wait` to propagate a command's own
// exit code without extra output).
type exitError struct {
	code int
	msg  string
}

func (e *exitError) Error() string { return e.msg }

const usage = `bump - control the bump terminal app from the command line

Usage:
  bump <command> [args] [--json] [--dev]

Commands:
  status                          show server, workspace and terminal counts
  ls, terminals                   list terminals (id, status, cwd, branch, pid, pane)
  ps                              list commands currently running in terminals
  watch [--terminal <id>]         stream command start/finish events (Ctrl-C to stop)
  workspaces, ws                  list workspaces and their panes
  run [flags] <command...>        run a command in a terminal
      --new                         run in a fresh terminal (new workspace)
      --workspace <id>              run in a fresh terminal in that workspace
      --pane <id>                   run in the terminal hosted by that pane
      --wait                        block until the command finishes; exit with
                                    its exit code (needs --pane or active pane)
      --timeout <dur>               with --wait, give up after e.g. 30s or 5m
      (default: the active pane's terminal)
  write <terminalId> <text...>    write raw text to a terminal (no newline)
  read <terminalId> [--lines N]   print recent terminal output
  close <terminalId>              close a terminal
  split <paneId> [--dir h|v] [--cmd "..."]
                                  split a pane, optionally running a command
  focus <paneId>                  focus a pane
  close-pane <paneId>             close a pane
  close-others <paneId>           close every pane except this one
  ws-new [dir]                    create a workspace (optionally in a directory)
  ws-switch <id>                  switch to a workspace
  ws-close <id>                   close a workspace
  ws-rename <id> <name...>        rename a workspace

Global flags:
  --json    print raw JSON (great for agents and scripts)
  --dev     talk to a dev build of bump (~/.bump-dev); also BUMP_DEV=1

bump must be open for these commands to work. The control server listens on
127.0.0.1 only and is gated by a per-session bearer token.`

func main() {
	if err := run(os.Args[1:]); err != nil {
		var ee *exitError
		if errors.As(err, &ee) {
			if ee.msg != "" {
				fmt.Fprintln(os.Stderr, "bump: "+ee.msg)
			}
			os.Exit(ee.code)
		}
		fmt.Fprintln(os.Stderr, "bump: "+err.Error())
		os.Exit(exitGeneric)
	}
}

type commandFunc func(c *client, args []string, jsonOut bool) error

var commands = map[string]commandFunc{
	"status":       cmdStatus,
	"ls":           cmdTerminals,
	"terminals":    cmdTerminals,
	"ps":           cmdPs,
	"watch":        cmdWatch,
	"workspaces":   cmdWorkspaces,
	"ws":           cmdWorkspaces,
	"run":          cmdRun,
	"write":        cmdWrite,
	"read":         cmdRead,
	"close":        cmdClose,
	"close-pane":   cmdClosePane,
	"close-others": cmdCloseOthers,
	"split":        cmdSplit,
	"focus":        cmdFocus,
	"ws-new":       cmdWsNew,
	"ws-switch":    cmdWsSwitch,
	"ws-close":     cmdWsClose,
	"ws-rename":    cmdWsRename,
}

func run(rawArgs []string) error {
	args, jsonOut := extractBool(rawArgs, "--json")
	args, dev := extractBool(args, "--dev")
	if os.Getenv("BUMP_DEV") == "1" {
		dev = true
	}

	if len(args) == 0 {
		fmt.Println(usage)
		return nil
	}

	cmd := args[0]
	if cmd == "help" || cmd == "-h" || cmd == "--help" {
		fmt.Println(usage)
		return nil
	}

	handler, ok := commands[cmd]
	if !ok {
		return fmt.Errorf("unknown command %q (run 'bump help')", cmd)
	}

	c, err := loadClient(dev)
	if err != nil {
		return err
	}
	return handler(c, args[1:], jsonOut)
}

func extractBool(args []string, name string) ([]string, bool) {
	out := make([]string, 0, len(args))
	found := false
	for _, a := range args {
		if a == name {
			found = true
			continue
		}
		out = append(out, a)
	}
	return out, found
}
