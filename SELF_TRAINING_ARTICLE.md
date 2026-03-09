---
title: OrcBot's Self-Training Sidecar: How to Improve an AI Agent Without Letting It Rewrite Itself Live
description: A practical introduction to OrcBot's self-training system, how it works, what it produces, and why offline evaluation beats risky live model mutation.
tags: ai, llm, agents, opensource, machinelearning
---

# OrcBot's Self-Training Sidecar

Most AI agent systems stop at orchestration.

They can call tools, browse the web, write files, and maybe even recover from failure. But when it comes to getting better over time, they usually fall into one of two bad options:

1. They never learn from their own work at all.
2. They try to learn in place, inside the live runtime, which is risky, hard to audit, and easy to get wrong.

OrcBot takes a different approach.

Instead of letting the live agent mutate itself mid-flight, OrcBot uses a self-training sidecar. The agent keeps doing useful work. In the background, it captures examples of successful behavior, filters them, turns them into training data, evaluates candidate models, and lets an admin decide whether a new model should be promoted.

That is the key idea:

**The agent learns from experience without turning production into an experiment.**

## The Problem With "Self-Improving" Agents

"Self-improving AI" sounds impressive until you ask what it really means.

In practice, most teams run into the same problems:

- Good and bad outcomes get mixed together.
- Sensitive data leaks into training logs.
- The live system changes behavior without enough evaluation.
- Nobody can explain why the model got better, worse, or just different.

For a production agent, that is not acceptable.

If an agent is handling real user requests, messaging channels, files, and automation flows, then learning has to be controlled. You need traceability. You need evaluation. You need a rollback story. Most of all, you need separation between runtime execution and model training.

That is what the OrcBot self-training sidecar is built for.

## What It Actually Does

At a high level, OrcBot observes its own completed work and extracts useful training examples from it.

When the agent successfully finishes a task, the system can record the trajectory of that run:

- the original task
- the important reasoning path
- tool calls and outcomes
- delivery quality signals
- the final user-facing result

But not every run becomes training data.

The system filters out weak examples, unresolved failures, empty status loops, and other low-value traces. Only accepted examples are exported into a training-ready dataset.

From there, OrcBot can:

- build a JSONL export for training
- generate a manifest for an offline training job
- evaluate candidate models against accepted trajectories
- register trained candidates
- promote a candidate into live use only after explicit approval

This is not a vague "AI learns over time" claim. It is a concrete pipeline.

## The Simple Version

If you know nothing about model training, think of it like this.

Imagine OrcBot is an employee.

Every time it handles a task well, someone saves the best parts of that case into a notebook. After enough good cases, you use that notebook to train a new employee. Then you test that new employee before giving them real responsibility.

That is OrcBot's self-training sidecar.

The live agent keeps working.
The notebook gets better.
Candidate models get tested.
Rollout stays deliberate.

## What It Does Not Do

This system does **not** train a frontier LLM from scratch.

It is not trying to build the next GPT-class foundation model from zero parameters. That kind of training needs enormous datasets, GPU clusters, and a completely different infrastructure profile.

Instead, OrcBot is built for the realistic version of self-improvement:

- fine-tuning an existing base model
- instruction-tuning a smaller local model
- creating a more specialized model for OrcBot-style tasks
- learning from your own workflows instead of generic internet data

So yes, it can help you create a **new model candidate** for your system.

No, it is not trying to invent a whole new foundation model from scratch.

## Why This Matters

Generic LLMs are broad, but broad is not the same as aligned.

An agent like OrcBot has a very specific job:

- plan multi-step tasks
- call tools correctly
- recover from failures
- communicate results clearly
- operate safely across real channels and environments

A model that has seen examples of exactly that behavior can become much better at those tasks than a generic baseline.

That is where the self-training sidecar becomes valuable.

It helps you move from:

"This model is generally smart"

to:

"This model is unusually good at being *our* agent."

## The Workflow

Here is the OrcBot self-training loop in plain language.

### 1. Capture

Completed actions can be turned into trajectories.

These trajectories include the task, tool use, result signals, and final delivery outcome. The point is not to save every token forever. The point is to preserve enough structure to learn from successful work.

### 2. Filter

Not all examples are worth keeping.

The system rejects low-quality traces, unresolved failures, and weak outcomes. This matters more than most people realize. Bad training data does not just waste time. It can actively teach the wrong behavior.

### 3. Redact

Sensitive information is cleaned before persistence and export.

If you are going to train on real operational history, this step is non-negotiable.

### 4. Prepare

Once enough accepted examples exist, OrcBot writes a JSONL dataset and a job manifest for offline training.

That makes the output usable by an external training pipeline instead of trapping it in a proprietary runtime-only format.

### 5. Evaluate

Candidate models are scored against accepted trajectories.

This is where the system asks the hard question: is the new model actually better, or just different?

### 6. Register

If you train a candidate model externally, OrcBot can register that candidate and keep track of what it is, where it came from, and how it performed.

### 7. Promote

Promotion is explicit and admin-controlled.

The model only moves into live config after the evaluation gate passes and a human chooses to roll it out.

That separation is the whole safety story.

## Why the Safety Model Is the Real Feature

A lot of systems talk about learning.
Very few talk enough about control.

The most important thing about OrcBot's self-training system is not that it creates training data. Plenty of systems can dump logs into a file. The important part is that it treats training and rollout as separate concerns.

That gives you:

- redaction before export
- quality gating before training
- evaluation before promotion
- explicit rollout decisions
- clear previous-model context for rollback

In other words, it is designed for teams that want improvement without surrendering operational discipline.

## What Artifacts It Produces

The sidecar produces concrete files you can inspect, archive, or feed into external tooling.

- `self-training-trajectories.json`: captured trajectories
- `self-training-trajectories.jsonl`: accepted examples only
- `self-training-job.json`: current offline training manifest
- `self-training-eval-report.json`: evaluation results
- `self-training-launch.json`: launch history and audit trail
- `self-training-candidates.json`: registered candidate models
- `self-training-promotion.json`: latest promotion record

This matters because it keeps the process inspectable. You are not guessing what happened. You can open the artifacts and review the chain from captured work to promoted model.

## What You Can Build With It

With enough high-quality accepted examples, the self-training sidecar can support workflows like:

- a smaller internal agent that is better at OrcBot-specific tool usage
- a tuned local model for support, operations, or research workflows
- a candidate model specialized for your own prompts, tone, and task patterns
- a continuous improvement loop where every good action can eventually contribute to a better successor model

That makes OrcBot more than an orchestration layer. It becomes a data engine for improving the model layer around the agent.

## The Core Idea in One Sentence

OrcBot does not let a live agent recklessly retrain itself.

It turns real work into reviewable training data, evaluates candidate models offline, and only promotes new behavior when the evidence is good enough.

## Why This Is a Better Story Than "The Agent Just Gets Smarter"

"It gets smarter over time" is marketing.

"It captures successful trajectories, filters them, produces training-ready datasets, evaluates candidates, and promotes them under admin control" is engineering.

OrcBot is built around the second idea.

That makes it useful for people who want more than hype. It is a path toward better agent behavior that is inspectable, reproducible, and safe enough to operate in real systems.

## Final Thought

The future of agent systems is not just better prompting.

It is better feedback loops.

The winners will be the systems that can learn from their own real work without becoming unstable, opaque, or impossible to trust. OrcBot's self-training sidecar is an early version of that future: a practical loop for turning production experience into better candidate models while keeping runtime behavior under control.

If you want an autonomous agent that can improve over time without blurring the line between execution and experimentation, that is exactly what this system is for.