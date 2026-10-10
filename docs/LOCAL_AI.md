# Local AI models

ApplyPilot can use an AI model that runs on your own PC instead of Claude. Cover letters, tailored
resumes, screening answers, interview prep and plain-English job search all use whichever model you choose.

Your data stays on this PC: the only address ApplyPilot sends it to is the one you enter in
**Settings → AI → Local model**. Point it only at a server you run yourself.

## Set up Ollama (recommended)

1. Install Ollama from ollama.com.
2. Pull an instruction-tuned model (one time, from a terminal):

   ```bash
   ollama pull llama3.1
   ```

3. Ollama serves an OpenAI-compatible API at `http://localhost:11434/v1`, which is ApplyPilot's default.
4. In ApplyPilot: **Settings → AI → Local model on your PC** → **Find models** → pick the model.

## LM Studio

Start the local server in LM Studio (Developer tab). Its address is usually `http://localhost:1234/v1`.
Enter that address in ApplyPilot and click **Find models**.

## Which model?

- Plain-English search and screening answers need a model that follows JSON instructions well.
  Good starting points: llama3.1 8B, qwen2.5 7B or mistral 7B.
- Cover letters and resume tailoring read best with larger models (14B+) if your PC can run them.

## Limits and safety

- Local models count toward your plan's daily AI allowance, the same as Claude.
- ApplyPilot's verification still applies: the tailored resume is checked against your original, and
  every job from plain-English search is a real posting from a live source. A model can propose a
  company or a role, but it can't add a job.
- If the server isn't running, ApplyPilot says so and falls back to the manual path (for example
  the Answer bank for screening questions).
