package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type parsedArgs struct {
	positional []string
	values     map[string]string
	bools      map[string]bool
}

func parseArgs(
	args []string,
	valueFlags map[string]bool,
	boolFlags map[string]bool,
) (*parsedArgs, error) {
	p := &parsedArgs{values: map[string]string{}, bools: map[string]bool{}}
	for i := 0; i < len(args); i++ {
		a := args[i]
		if !strings.HasPrefix(a, "--") {
			p.positional = append(p.positional, a)
			continue
		}
		name := a[2:]
		if eq := strings.IndexByte(name, '='); eq >= 0 {
			key := name[:eq]
			if !valueFlags[key] {
				return nil, fmt.Errorf("unknown flag --%s", key)
			}
			p.values[key] = name[eq+1:]
			continue
		}
		switch {
		case boolFlags[name]:
			p.bools[name] = true
		case valueFlags[name]:
			if i+1 >= len(args) {
				return nil, fmt.Errorf("flag --%s requires a value", name)
			}
			i++
			p.values[name] = args[i]
		default:
			return nil, fmt.Errorf("unknown flag --%s", name)
		}
	}
	return p, nil
}

func cmdStatus(c *client, _ []string, jsonOut bool) error {
	data, err := c.get("/status")
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}
	var s statusData
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	fmt.Printf("bump %s (pid %d)\n", s.Version, s.Pid)
	fmt.Printf("workspaces: %d\n", s.WorkspaceCount)
	fmt.Printf("terminals:  %d\n", s.TerminalCount)
	fmt.Printf("uptime:     %s\n", formatDuration(s.UptimeMs))
	return nil
}

func cmdTerminals(c *client, _ []string, jsonOut bool) error {
	data, err := c.get("/terminals")
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}
	var td terminalsData
	if err := json.Unmarshal(data, &td); err != nil {
		return err
	}
	if len(td.Terminals) == 0 {
		fmt.Println("no terminals")
		return nil
	}
	tw := newTable()
	fmt.Fprintln(tw, "TERMINAL\tSTATUS\tTITLE\tCWD\tBRANCH\tPID\tWORKSPACE\tPANE")
	for _, t := range td.Terminals {
		cwd := "-"
		if t.Cwd != nil {
			cwd = shortHome(*t.Cwd)
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n",
			t.ID,
			jobStatusLabel(t.Job),
			truncate(t.Title, 24),
			truncate(cwd, 40),
			strOr(t.GitBranch, "-"),
			intOr(t.Pid, "-"),
			strOr(t.WorkspaceID, "-"),
			strOr(t.PaneID, "-"),
		)
	}
	return tw.Flush()
}

func cmdPs(c *client, _ []string, jsonOut bool) error {
	data, err := c.get("/jobs")
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}
	var jd jobsData
	if err := json.Unmarshal(data, &jd); err != nil {
		return err
	}
	if len(jd.Jobs) == 0 {
		fmt.Println("no commands running")
		return nil
	}
	tw := newTable()
	fmt.Fprintln(tw, "TERMINAL\tELAPSED\tCOMMAND")
	for _, j := range jd.Jobs {
		elapsed := "-"
		if j.ElapsedMs != nil {
			elapsed = formatElapsed(*j.ElapsedMs)
		}
		cmd := "-"
		if j.Command != nil && *j.Command != "" {
			cmd = *j.Command
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\n", j.ID, elapsed, truncate(cmd, 60))
	}
	return tw.Flush()
}

func cmdWatch(c *client, args []string, jsonOut bool) error {
	p, err := parseArgs(args, map[string]bool{"terminal": true}, nil)
	if err != nil {
		return err
	}
	path := "/events"
	if t, ok := p.values["terminal"]; ok {
		path += "?terminal=" + url.QueryEscape(t)
	}

	resp, err := c.stream(path)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	var payload string
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "data:"):
			payload = strings.TrimSpace(line[len("data:"):])
		case line == "":
			if payload == "" {
				continue
			}
			if jsonOut {
				fmt.Println(payload)
			} else {
				var ev commandEvent
				if json.Unmarshal([]byte(payload), &ev) == nil {
					printWatchEvent(ev)
				}
			}
			payload = ""
		}
	}
	if err := scanner.Err(); err != nil {
		return &exitError{code: exitNotRunning, msg: "event stream closed: " + err.Error()}
	}
	return nil
}

func cmdWorkspaces(c *client, _ []string, jsonOut bool) error {
	data, err := c.get("/workspaces")
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}
	var wd workspacesData
	if err := json.Unmarshal(data, &wd); err != nil {
		return err
	}
	if len(wd.Workspaces) == 0 {
		fmt.Println("no workspaces")
		return nil
	}
	tw := newTable()
	fmt.Fprintln(tw, "\tWORKSPACE\tNAME\tPANES\tACTIVE PANE")
	for _, ws := range wd.Workspaces {
		marker := " "
		if ws.IsActive {
			marker = "*"
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\t%d\t%s\n",
			marker, ws.ID, truncate(ws.Name, 24), len(ws.Panes), ws.ActivePaneID)
	}
	return tw.Flush()
}

func cmdRun(c *client, args []string, jsonOut bool) error {
	var workspace, pane, timeoutStr string
	newTerm := false
	wait := false

	idx := 0
	for idx < len(args) {
		a := args[idx]
		if a == "--" {
			idx++
			break
		}
		if !strings.HasPrefix(a, "-") {
			break
		}
		switch {
		case a == "--new" || a == "-n":
			newTerm = true
			idx++
		case a == "--wait":
			wait = true
			idx++
		case a == "--workspace" || a == "-w":
			if idx+1 >= len(args) {
				return errors.New("--workspace requires a value")
			}
			workspace = args[idx+1]
			idx += 2
		case strings.HasPrefix(a, "--workspace="):
			workspace = strings.TrimPrefix(a, "--workspace=")
			idx++
		case a == "--pane" || a == "-p":
			if idx+1 >= len(args) {
				return errors.New("--pane requires a value")
			}
			pane = args[idx+1]
			idx += 2
		case strings.HasPrefix(a, "--pane="):
			pane = strings.TrimPrefix(a, "--pane=")
			idx++
		case a == "--timeout":
			if idx+1 >= len(args) {
				return errors.New("--timeout requires a value")
			}
			timeoutStr = args[idx+1]
			idx += 2
		case strings.HasPrefix(a, "--timeout="):
			timeoutStr = strings.TrimPrefix(a, "--timeout=")
			idx++
		default:
			return fmt.Errorf("unknown flag %q for run (put flags before the command)", a)
		}
	}

	command := strings.Join(args[idx:], " ")
	if strings.TrimSpace(command) == "" {
		return errors.New("run requires a command, e.g. bump run \"npm test\"")
	}

	if wait {
		if newTerm || workspace != "" {
			return errors.New("--wait needs an existing terminal; use --pane <id> or the active pane, not --new/--workspace")
		}
		return runWait(c, pane, command, timeoutStr, jsonOut)
	}
	if timeoutStr != "" {
		return errors.New("--timeout only applies together with --wait")
	}

	var data json.RawMessage
	var err error
	switch {
	case newTerm:
		data, err = c.post("/terminals", map[string]any{"command": command})
	case workspace != "":
		data, err = c.post("/terminals", map[string]any{
			"workspaceId": workspace,
			"command":     command,
		})
	case pane != "":
		var terminalID string
		terminalID, err = c.resolvePaneTerminal(pane)
		if err == nil {
			data, err = c.post("/terminals/"+terminalID+"/run",
				map[string]any{"command": command})
		}
	default:
		var terminalID string
		terminalID, err = c.resolveActiveTerminal()
		if err == nil {
			data, err = c.post("/terminals/"+terminalID+"/run",
				map[string]any{"command": command})
		}
	}
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}

	var r mutationResult
	if err := json.Unmarshal(data, &r); err != nil {
		return err
	}
	target := r.TerminalID
	if target == "" {
		target = r.ID
	}
	fmt.Printf("ran in %s: %s\n", target, command)
	return nil
}

// runWait issues a command and blocks until its matching OSC 133 completion,
// then exits with the command's own exit code so `bump run --wait ... && ...`
// works for scripting.
func runWait(c *client, pane, command, timeoutStr string, jsonOut bool) error {
	var terminalID string
	var err error
	if pane != "" {
		terminalID, err = c.resolvePaneTerminal(pane)
	} else {
		terminalID, err = c.resolveActiveTerminal()
	}
	if err != nil {
		return err
	}

	body := map[string]any{"command": command, "wait": true}
	var clientTimeout time.Duration
	if timeoutStr != "" {
		d, perr := parseTimeout(timeoutStr)
		if perr != nil {
			return perr
		}
		body["timeoutMs"] = d.Milliseconds()
		// Give the server's own deadline room to fire first.
		clientTimeout = d + 30*time.Second
	}

	data, err := c.requestTimeout("POST", "/terminals/"+terminalID+"/run", body, clientTimeout)
	if err != nil {
		var ae *apiError
		if errors.As(err, &ae) {
			switch ae.status {
			case 504:
				return &exitError{code: exitTimeout, msg: ae.message}
			case 409:
				return &exitError{code: exitBusy, msg: ae.message}
			case 404, 410:
				return &exitError{code: exitUnknownID, msg: ae.message}
			}
		}
		return err
	}

	var r runWaitData
	if err := json.Unmarshal(data, &r); err != nil {
		return err
	}
	if jsonOut {
		if perr := printJSONValue(map[string]any{
			"command":    r.Command,
			"exitCode":   r.ExitCode,
			"durationMs": r.DurationMs,
		}); perr != nil {
			return perr
		}
	}
	code := 0
	if r.ExitCode != nil {
		code = *r.ExitCode
	}
	return &exitError{code: code}
}

func parseTimeout(s string) (time.Duration, error) {
	if d, err := time.ParseDuration(s); err == nil {
		if d <= 0 {
			return 0, errors.New("--timeout must be positive")
		}
		return d, nil
	}
	if n, err := strconv.Atoi(s); err == nil {
		if n <= 0 {
			return 0, errors.New("--timeout must be positive")
		}
		return time.Duration(n) * time.Second, nil
	}
	return 0, fmt.Errorf("invalid --timeout %q (use e.g. 30s, 5m, or a number of seconds)", s)
}

func cmdWrite(c *client, args []string, jsonOut bool) error {
	p, err := parseArgs(args, nil, nil)
	if err != nil {
		return err
	}
	if len(p.positional) < 2 {
		return errors.New("usage: bump write <terminalId> <text...>")
	}
	terminalID := p.positional[0]
	text := strings.Join(p.positional[1:], " ")
	data, err := c.post("/terminals/"+terminalID+"/write",
		map[string]any{"data": text})
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}
	fmt.Printf("wrote %d bytes to %s\n", len(text), terminalID)
	return nil
}

func cmdRead(c *client, args []string, jsonOut bool) error {
	p, err := parseArgs(args, map[string]bool{"lines": true}, nil)
	if err != nil {
		return err
	}
	if len(p.positional) < 1 {
		return errors.New("usage: bump read <terminalId> [--lines N]")
	}
	path := "/terminals/" + p.positional[0] + "/buffer"
	if lines, ok := p.values["lines"]; ok {
		path += "?lines=" + url.QueryEscape(lines)
	}
	data, err := c.get(path)
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}
	var b bufferData
	if err := json.Unmarshal(data, &b); err != nil {
		return err
	}
	fmt.Print(b.Buffer)
	if !strings.HasSuffix(b.Buffer, "\n") {
		fmt.Println()
	}
	return nil
}

func cmdClose(c *client, args []string, jsonOut bool) error {
	p, err := parseArgs(args, nil, nil)
	if err != nil {
		return err
	}
	if len(p.positional) < 1 {
		return errors.New("usage: bump close <terminalId>")
	}
	id := p.positional[0]
	data, err := c.del("/terminals/" + id)
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}
	fmt.Printf("closed terminal %s\n", id)
	return nil
}

func cmdClosePane(c *client, args []string, jsonOut bool) error {
	p, err := parseArgs(args, nil, nil)
	if err != nil {
		return err
	}
	if len(p.positional) < 1 {
		return errors.New("usage: bump close-pane <paneId>")
	}
	id := p.positional[0]
	data, err := c.del("/panes/" + id)
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}
	fmt.Printf("closed pane %s\n", id)
	return nil
}

func cmdCloseOthers(c *client, args []string, jsonOut bool) error {
	p, err := parseArgs(args, nil, nil)
	if err != nil {
		return err
	}
	if len(p.positional) < 1 {
		return errors.New("usage: bump close-others <paneId>")
	}
	id := p.positional[0]
	data, err := c.post("/panes/"+id+"/close-others", nil)
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}
	fmt.Printf("closed panes other than %s\n", id)
	return nil
}

func normalizeDirection(value string) (string, error) {
	switch strings.ToLower(value) {
	case "h", "horizontal", "right":
		return "horizontal", nil
	case "v", "vertical", "down":
		return "vertical", nil
	default:
		return "", fmt.Errorf("invalid --dir %q (use h or v)", value)
	}
}

func cmdSplit(c *client, args []string, jsonOut bool) error {
	p, err := parseArgs(args, map[string]bool{"dir": true, "cmd": true}, nil)
	if err != nil {
		return err
	}
	if len(p.positional) < 1 {
		return errors.New("usage: bump split <paneId> [--dir h|v] [--cmd \"...\"]")
	}
	direction := "horizontal"
	if d, ok := p.values["dir"]; ok {
		direction, err = normalizeDirection(d)
		if err != nil {
			return err
		}
	}
	body := map[string]any{"direction": direction}
	if cmd, ok := p.values["cmd"]; ok {
		body["command"] = cmd
	}
	data, err := c.post("/panes/"+p.positional[0]+"/split", body)
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}
	var r mutationResult
	if err := json.Unmarshal(data, &r); err != nil {
		return err
	}
	fmt.Printf("split into pane %s (terminal %s)\n", r.PaneID, r.TerminalID)
	return nil
}

func cmdFocus(c *client, args []string, jsonOut bool) error {
	p, err := parseArgs(args, nil, nil)
	if err != nil {
		return err
	}
	if len(p.positional) < 1 {
		return errors.New("usage: bump focus <paneId>")
	}
	id := p.positional[0]
	data, err := c.post("/panes/"+id+"/focus", nil)
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}
	fmt.Printf("focused pane %s\n", id)
	return nil
}

func cmdWsNew(c *client, args []string, jsonOut bool) error {
	p, err := parseArgs(args, nil, nil)
	if err != nil {
		return err
	}
	body := map[string]any{}
	if len(p.positional) > 0 {
		body["cwd"] = p.positional[0]
	}
	data, err := c.post("/workspaces", body)
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}
	var r mutationResult
	if err := json.Unmarshal(data, &r); err != nil {
		return err
	}
	fmt.Printf("created workspace %s (pane %s, terminal %s)\n",
		r.WorkspaceID, r.PaneID, r.TerminalID)
	return nil
}

func cmdWsSwitch(c *client, args []string, jsonOut bool) error {
	p, err := parseArgs(args, nil, nil)
	if err != nil {
		return err
	}
	if len(p.positional) < 1 {
		return errors.New("usage: bump ws-switch <workspaceId>")
	}
	id := p.positional[0]
	data, err := c.post("/workspaces/"+id+"/activate", nil)
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}
	fmt.Printf("switched to workspace %s\n", id)
	return nil
}

func cmdWsClose(c *client, args []string, jsonOut bool) error {
	p, err := parseArgs(args, nil, nil)
	if err != nil {
		return err
	}
	if len(p.positional) < 1 {
		return errors.New("usage: bump ws-close <workspaceId>")
	}
	id := p.positional[0]
	data, err := c.del("/workspaces/" + id)
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}
	fmt.Printf("closed workspace %s\n", id)
	return nil
}

func cmdWsRename(c *client, args []string, jsonOut bool) error {
	p, err := parseArgs(args, nil, nil)
	if err != nil {
		return err
	}
	if len(p.positional) < 2 {
		return errors.New("usage: bump ws-rename <workspaceId> <name...>")
	}
	id := p.positional[0]
	name := strings.Join(p.positional[1:], " ")
	data, err := c.patch("/workspaces/"+id, map[string]any{"name": name})
	if err != nil {
		return err
	}
	if jsonOut {
		return printJSON(data)
	}
	fmt.Printf("renamed workspace %s to %q\n", id, name)
	return nil
}
