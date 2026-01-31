# OrcBot Skills Registry

This file lists the available skills for the agent.

## Internal Skills (Core)
- **send_telegram(chat_id, message)**: Reply to users on Telegram.
- **run_command(command)**: Execute shell commands (e.g., `ls`, `npm test`).
- **manage_skills(skill_definition)**: Add new skills by defining them here.
- **update_user_profile(info_text)**: Persistent memory about the user.
- **update_agent_identity(trait)**: Persistent evolution of personality.
- **deep_reason(topic)**: High-intensity analysis using chain-of-thought.
- **schedule_task(time_or_cron, task)**: Schedule actions for later (e.g. "in 5 minutes").

## Web Skills (Browsing & Search)
- **web_search(query)**: Search the web via DuckDuckGo.
- **browser_navigate(url)**: Visit a website and extract content.
- **extract_article(url)**: Get clean story/article text from a link (removes ads/clutter).

## Community Skills
(Add your custom skills here)
