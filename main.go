package main

import (
	"fmt"
	"log"
	"time"

	"github.com/charmbracelet/bubbles/textinput"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type Styles struct {
	BorderColor lipgloss.Color
	InputField  lipgloss.Style
}

func DefaultStyle() *Styles {
	s := new(Styles)
	s.InputField = lipgloss.NewStyle()
	return s
}

type model struct {
	index   int
	history []string
	width   int
	height  int
	command textinput.Model
	style   *Styles
}

func New(history []string) *model {
	style := DefaultStyle()
	command := textinput.New()
	command.Focus()
	return &model{
		history: history,
		command: command,
		style:   style,
	}
}

// Define the application's initial state
func (m model) Init() tea.Cmd {
	return nil
}

// Checks to see what kind of keyboard input is going on
func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	var cmd tea.Cmd
	ctime := time.Now()

	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

		m.style.InputField = m.style.InputField.Width(m.width - 2)

	case tea.KeyMsg:
		switch msg.String() {

		case "enter":
			m.history = append(m.history, m.command.Value())
			fmt.Println(ctime.Format(time.Kitchen), ">", m.command.Value())
			m.command.Reset()
			m.index++
			return m, nil

		case "up":
			if m.index > 0 {
				m.command.SetValue(m.history[m.index])
				m.index--
			}

		case "down":
			if m.index < len(m.history)-1 {
				m.index++
				m.command.SetValue(m.history[m.index])
			} else {
				m.command.Reset()
			}

		case "ctrl+c":
			return m, tea.Quit
		}
	}
	m.command, cmd = m.command.Update(msg)
	return m, cmd
}

// What is displayed on the TUI
func (m model) View() string {
	if m.width == 0 {
		return "Loading..."
	}

	return m.style.InputField.Render(m.command.View()) + ""
}

// Where our program starts
func main() {
	// check for errors. If error output to the debug.log
	f, err := tea.LogToFile("debug.log", "debug")
	if err != nil {
		log.Fatalf("Error: %w", err)
	}
	defer f.Close()

	history := []string{"Yggdrasil"}

	p := tea.NewProgram(New(history))

	println(
		`
	▄██   ▄      ▄██████▄     ▄██████▄  ████████▄     ▄████████    ▄████████    ▄████████  ▄█   ▄█       
	███   ██▄   ███    ███   ███    ███ ███   ▀███   ███    ███   ███    ███   ███    ███ ███  ███       
	███▄▄▄███   ███    █▀    ███    █▀  ███    ███   ███    ███   ███    ███   ███    █▀  ███▌ ███       
	▀▀▀▀▀▀███  ▄███         ▄███        ███    ███  ▄███▄▄▄▄██▀   ███    ███   ███        ███▌ ███       
	▄██   ███ ▀▀███ ████▄  ▀▀███ ████▄  ███    ███ ▀▀███▀▀▀▀▀   ▀███████████ ▀███████████ ███▌ ███       
	███   ███   ███    ███   ███    ███ ███    ███ ▀███████████   ███    ███          ███ ███  ███       
	███   ███   ███    ███   ███    ███ ███   ▄███   ███    ███   ███    ███    ▄█    ███ ███  ███▌    ▄ 
 	▀█████▀    ████████▀    ████████▀  ████████▀    ███    ███   ███    █▀   ▄████████▀  █▀   █████▄▄██ 
    	                                            ███    ███                                ▀         

		`)

	if _, err := p.Run(); err != nil {
		log.Fatalf("Error: %w", err)
	}
}
