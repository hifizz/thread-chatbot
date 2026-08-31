# Prompt Cache Apply Progress

Implementation is tracked by `openspec/changes/optimize-thread-chat-prompt-cache/tasks.md`.

The implementation uses deterministic fake provider probes when live Claude credentials are unavailable. Production routes remain disabled until provider cache usage and cost savings are proven.
