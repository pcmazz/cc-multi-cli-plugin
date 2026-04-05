---
name: gemini
description: Use when the user asks to consult Gemini, get a second opinion from another model, or wants Gemini's perspective on code, architecture, research, or any technical question
---

# Gemini Skill Guide

Gemini CLI is used as a **read-only consultant** — a second brain for getting alternative perspectives, research, and sanity checks. It never edits files or executes tools.

## Running a Consultation

1. Construct the prompt for Gemini. Frame it with clear context about what you need a second opinion or research on.
2. If the user provides or references specific code/content to share with Gemini, pipe it via stdin. Otherwise use a direct prompt.
3. Assemble the command:
   - Default model: `gemini-3.1-pro-preview`. Only use a different model if the user explicitly requests one.
   - Always use `-p` for headless (non-interactive) mode.
   - Always append `2>/dev/null` to suppress stderr noise.

### Command Patterns

**Direct prompt (no piped context):**
```bash
gemini -m gemini-3.1-pro-preview -p "your prompt here" 2>/dev/null
```

**With piped context (code, logs, files, etc.):**
```bash
echo "<context>" | gemini -m gemini-3.1-pro-preview -p "your question about this context" 2>/dev/null
```

**Referencing project files (using Gemini's @ syntax):**
```bash
gemini -m gemini-3.1-pro-preview -p "Review @src/main.ts and suggest improvements" 2>/dev/null
```

4. Run the command and capture stdout.
5. Present Gemini's response to the user with a brief summary of the key points.

### Quick Reference
| Use case | Command pattern |
| --- | --- |
| Second opinion on approach | `gemini -m gemini-3.1-pro-preview -p "prompt" 2>/dev/null` |
| Review specific code | `echo "<code>" \| gemini -m gemini-3.1-pro-preview -p "Review this" 2>/dev/null` |
| Research a topic | `gemini -m gemini-3.1-pro-preview -p "Explain X in depth" 2>/dev/null` |
| Reference project files | `gemini -m gemini-3.1-pro-preview -p "Analyze @path/to/file" 2>/dev/null` |

## Critical Evaluation of Gemini Output

Gemini is a peer, not an authority. Evaluate its responses critically.

### Automatic Follow-Up
If you spot a **clear misunderstanding** in Gemini's response — a factual error, a misread of the code, or a flawed premise — send a follow-up message to Gemini to clarify:
```bash
echo "Following up on your previous response: [specific issue]. [Correction or clarification]. Can you reconsider with this in mind?" | gemini -m gemini-3.1-pro-preview -p "Please revise your analysis." 2>/dev/null
```

Only do this for clear misunderstandings. For subjective disagreements or ambiguous points, present both perspectives to the user and let them decide.

### When You Disagree
1. Present Gemini's response to the user
2. State your disagreement clearly with evidence
3. Let the user decide how to proceed if there's genuine ambiguity

## After Consultation
- Summarize Gemini's key points and any areas where your own analysis differs
- Inform the user: "I can ask Gemini follow-up questions if you'd like to dig deeper on any of these points."
- If the user wants to continue, construct a new prompt with the follow-up context

## Error Handling
- If `gemini` exits non-zero, report the failure and suggest the user check that Gemini CLI is installed and authenticated (`gemini --version`).
- Exit code `1`: general error or API failure.
- Exit code `42`: invalid prompt or arguments.
- Exit code `53`: turn limit exceeded.

## What This Skill Does NOT Do
- No file editing or code changes — Gemini is read-only here
- No session resumption — each consultation is stateless
- No sandbox or approval modes — headless `-p` has no tool access
