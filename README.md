# skill-gemini

A Claude Code plugin that lets you consult Gemini CLI as a read-only thinker for second opinions, research, and alternative perspectives.

## Prerequisites

- [Gemini CLI](https://geminicli.com) installed and authenticated
- [Claude Code](https://claude.com/claude-code) installed

## Install

Add this marketplace to Claude Code:

```
/plugin marketplace add <your-github-username>/skill-gemini
```

Then install the plugin:

```
/plugin install skill-gemini
```

## Usage

Ask Claude to consult Gemini on anything:

- "Ask Gemini what it thinks about this approach"
- "Get a second opinion from Gemini on this architecture"
- "Have Gemini research X for me"

The skill uses `gemini-3.1-pro-preview` by default. Request a different model explicitly if needed.

## How it works

The skill runs Gemini CLI in headless mode (`gemini -p "prompt"`), captures the response, and presents it with Claude's own critical evaluation. If Claude spots a clear misunderstanding in Gemini's response, it will automatically follow up for clarification. For subjective disagreements, both perspectives are presented for you to decide.

## License

MIT
