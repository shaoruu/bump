package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

type client struct {
	baseURL string
	token   string
	http    *http.Client
}

func bumpDir(dev bool) string {
	if v := os.Getenv("BUMP_DIR"); v != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	if dev {
		return filepath.Join(home, ".bump-dev")
	}
	return filepath.Join(home, ".bump")
}

func controlFilePath(dev bool) string {
	return filepath.Join(bumpDir(dev), "control.json")
}

func loadClient(dev bool) (*client, error) {
	path := controlFilePath(dev)
	raw, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, &exitError{code: exitNotRunning, msg: fmt.Sprintf("bump is not running (no control file at %s)", path)}
		}
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}

	var cf controlFile
	if err := json.Unmarshal(raw, &cf); err != nil {
		return nil, fmt.Errorf("parsing %s: %w", path, err)
	}
	if cf.Port == 0 || cf.Token == "" {
		return nil, fmt.Errorf("control file %s is incomplete", path)
	}

	return &client{
		baseURL: fmt.Sprintf("http://127.0.0.1:%d", cf.Port),
		token:   cf.Token,
		http:    &http.Client{Timeout: 30 * time.Second},
	}, nil
}

// apiError carries the HTTP status so callers (notably `run --wait`) can map
// specific failures to distinct exit codes.
type apiError struct {
	status  int
	message string
}

func (e *apiError) Error() string {
	if e.message != "" {
		return e.message
	}
	return fmt.Sprintf("request failed with status %d", e.status)
}

func (c *client) doRequest(hc *http.Client, method, path string, body any) (json.RawMessage, error) {
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(buf)
	}

	req, err := http.NewRequest(method, c.baseURL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := hc.Do(req)
	if err != nil {
		return nil, &exitError{code: exitNotRunning, msg: fmt.Sprintf("could not reach bump at %s (is it still running?): %v", c.baseURL, err)}
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var env envelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil, fmt.Errorf("unexpected response (%d): %s", resp.StatusCode, string(raw))
	}
	if !env.OK {
		return nil, &apiError{status: resp.StatusCode, message: env.Error}
	}
	return env.Data, nil
}

func (c *client) request(method, path string, body any) (json.RawMessage, error) {
	return c.doRequest(c.http, method, path, body)
}

// requestTimeout runs a single request with a bespoke timeout (0 = no timeout),
// used for run-wait where the caller decides how long to block.
func (c *client) requestTimeout(method, path string, body any, timeout time.Duration) (json.RawMessage, error) {
	return c.doRequest(&http.Client{Timeout: timeout}, method, path, body)
}

// stream opens a long-lived GET (no client timeout) for Server-Sent Events.
func (c *client) stream(path string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := (&http.Client{}).Do(req)
	if err != nil {
		return nil, &exitError{code: exitNotRunning, msg: fmt.Sprintf("could not reach bump at %s (is it still running?): %v", c.baseURL, err)}
	}
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		var env envelope
		if json.Unmarshal(raw, &env) == nil && env.Error != "" {
			return nil, &apiError{status: resp.StatusCode, message: env.Error}
		}
		return nil, fmt.Errorf("event stream failed with status %d", resp.StatusCode)
	}
	return resp, nil
}

func (c *client) get(path string) (json.RawMessage, error) {
	return c.request(http.MethodGet, path, nil)
}

func (c *client) del(path string) (json.RawMessage, error) {
	return c.request(http.MethodDelete, path, nil)
}

func (c *client) post(path string, body any) (json.RawMessage, error) {
	return c.request(http.MethodPost, path, body)
}

func (c *client) patch(path string, body any) (json.RawMessage, error) {
	return c.request(http.MethodPatch, path, body)
}

func (c *client) fetchWorkspaces() (*workspacesData, error) {
	data, err := c.get("/workspaces")
	if err != nil {
		return nil, err
	}
	var wd workspacesData
	if err := json.Unmarshal(data, &wd); err != nil {
		return nil, err
	}
	return &wd, nil
}

func (c *client) resolvePaneTerminal(paneID string) (string, error) {
	wd, err := c.fetchWorkspaces()
	if err != nil {
		return "", err
	}
	for _, ws := range wd.Workspaces {
		for _, p := range ws.Panes {
			if p.PaneID == paneID {
				if p.TerminalID == nil {
					return "", fmt.Errorf("pane '%s' has no terminal yet", paneID)
				}
				return *p.TerminalID, nil
			}
		}
	}
	return "", fmt.Errorf("unknown pane '%s'", paneID)
}

func (c *client) resolveActiveTerminal() (string, error) {
	wd, err := c.fetchWorkspaces()
	if err != nil {
		return "", err
	}
	for _, ws := range wd.Workspaces {
		if !ws.IsActive {
			continue
		}
		for _, p := range ws.Panes {
			if p.PaneID == ws.ActivePaneID {
				if p.TerminalID == nil {
					return "", errors.New("the active pane has no terminal yet; try --new")
				}
				return *p.TerminalID, nil
			}
		}
	}
	return "", errors.New("could not resolve the active terminal")
}
