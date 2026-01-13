# Product Hunt Launch Guide for tg-claude

## Product Overview

**Name:** tg-claude
**Tagline:** Control Claude Code remotely via Telegram or Discord
**Category:** Developer Tools, Productivity, AI, Open Source

## Pre-Launch Checklist

### 1. Product Hunt Account Setup
- [ ] Create/verify Product Hunt account at [producthunt.com](https://producthunt.com)
- [ ] Complete your maker profile (photo, bio, social links)
- [ ] Follow relevant hunters and makers in the AI/developer tools space
- [ ] Engage with the community for 1-2 weeks before launch

### 2. Prepare Assets

#### Logo
- **Required:** 240x240px square logo (PNG, no transparency)
- **Location:** Use `assets/claude.svg` converted to PNG

#### Gallery Images (5-8 recommended)
Create screenshots/images showing:
1. Telegram chat interface with bot commands
2. Discord integration in action
3. Claude Hub web interface
4. `/ralph` autonomous loop mode executing a task
5. Multi-provider toggle (Claude/GLM/OpenRouter)
6. Architecture diagram from README
7. Railway one-click deploy button
8. Plugin marketplace / MCP server configuration

**Image specs:** 1270x760px (recommended), PNG or GIF

#### Demo Video
- **Length:** 1-2 minutes max
- **Content:** Show the workflow from message to code execution
- **Existing demo:** https://x.com/uncanny_guzus/status/2006073533252919361

### 3. Product Hunt Listing Content

#### Short Description (60 chars max)
```
Control Claude Code remotely via Telegram or Discord
```

#### Full Description
```
tg-claude lets developers run Claude Code from anywhere using Telegram, Discord, or a web interface. No need to sit at your computer - just message your bot and let AI handle your coding tasks.

Key Features:

**Multi-Platform Access**
- Telegram bot for mobile-first developers
- Discord integration for team collaboration
- Claude Hub web interface for rich interactions

**Autonomous Coding**
- Ralph Loop Mode: AI iterates until the task is complete
- Plugin system for extended capabilities
- MCP server support for custom tools

**Flexible AI Providers**
- Claude (via subscription or API key)
- GLM from Z.ai
- OpenRouter (100+ models including GPT-5, Gemini, and more)

**Developer-Friendly**
- One-click Railway deployment
- Docker Compose for self-hosting
- GitHub integration for seamless workflows
- Tech stack presets (Bun, npm, uv, pip, etc.)

Perfect for:
- Running quick fixes while away from your desk
- Monitoring autonomous coding tasks on the go
- Team collaboration through Discord
- Developers who want AI assistance anywhere
```

#### First Comment (Maker's Comment)
```
Hey Product Hunt!

I built tg-claude because I wanted to run Claude Code while away from my computer. Sometimes you just need to fix a quick bug, review code, or start a coding task without opening your laptop.

What started as a simple Telegram bot evolved into a full platform:

- **Telegram & Discord**: Chat with Claude from anywhere
- **Claude Hub**: A web interface for richer interactions
- **Ralph Loop**: Autonomous mode that keeps iterating until done
- **Multi-AI**: Switch between Claude, GLM, or 100+ OpenRouter models

The architecture uses Anthropic's Claude Agent SDK with support for MCP servers, plugins, and skills - so you can extend it however you need.

Deploy in minutes with Railway's one-click button, or self-host with Docker.

Would love your feedback! What features would make this more useful for your workflow?
```

### 4. Launch Day Strategy

#### Timing
- **Best days:** Tuesday, Wednesday, or Thursday
- **Launch time:** 12:01 AM PST (when PH day resets)
- **Avoid:** Weekends, holidays, major tech events

#### Promotion Plan

**Day Before:**
- [ ] Schedule social media posts for launch day
- [ ] DM close friends/colleagues asking for support
- [ ] Prepare responses to common questions
- [ ] Brief any team members on launch timing

**Launch Day:**
- [ ] Post on Twitter/X with Product Hunt link
- [ ] Share in relevant Discord/Slack communities
- [ ] Post on Reddit (r/SideProject, r/programming, r/artificial, r/LocalLLaMA)
- [ ] Respond to ALL comments within 1-2 hours
- [ ] Share updates throughout the day

**Communities to Share:**
- Telegram developer groups
- Discord developer servers
- Claude/Anthropic community channels
- IndieHackers
- Hacker News (Show HN)
- Dev.to
- LinkedIn (developer networks)
- AI/ML focused Discord servers

### 5. Key Differentiators to Highlight

| Feature | tg-claude | Alternatives |
|---------|-----------|--------------|
| Multi-platform | Telegram + Discord + Web | Usually single platform |
| AI providers | Claude, GLM, OpenRouter (100+) | Usually locked to one |
| Autonomous mode | Ralph Loop with iteration | Basic single-shot |
| Extensibility | MCP + Plugins + Skills | Limited |
| Deployment | One-click Railway | Complex setup |
| Cost | Use your own AI subscription | Separate billing |

### 6. FAQ Preparation

**Q: Is this free?**
A: The bot itself is free and open source. You pay for your AI provider (Claude subscription or API) and hosting (~$5/mo on Railway).

**Q: How is this different from using Claude directly?**
A: tg-claude lets you access Claude Code's full capabilities (file editing, git, terminal) from mobile. It also adds autonomous loop mode, multi-repo management, and works with multiple AI providers.

**Q: Can I use this with my team?**
A: Yes! The Discord integration is great for teams. Each user is whitelisted individually for security.

**Q: Is my code safe?**
A: You self-host the bot, so your code never leaves your infrastructure. The bot only connects to your chosen AI provider.

**Q: Can I use models other than Claude?**
A: Yes! Switch to GLM or use OpenRouter to access 100+ models including GPT-5, Gemini, Llama, and more.

## Product Hunt Submission Form

| Field | Value |
|-------|-------|
| Name | tg-claude |
| Tagline | Control Claude Code remotely via Telegram or Discord |
| Links | GitHub: https://github.com/guzus/tg-claude |
| Topics | Developer Tools, Telegram, Discord, Artificial Intelligence, Open Source |
| Pricing | Free (uses your own AI subscription) |
| Status | Launched |

## Sample Social Media Posts

### Twitter/X Launch Post
```
Just launched tg-claude on @ProductHunt!

Control Claude Code from Telegram, Discord, or web:

-> Ralph Loop: autonomous coding that iterates until done
-> Multi-AI: Claude, GLM, or 100+ OpenRouter models
-> One-click deploy on Railway
-> MCP servers & plugins

Check it out: [PH Link]

#buildinpublic #ai #devtools
```

### LinkedIn Post
```
Excited to share my latest project on Product Hunt: tg-claude

As developers, we're not always at our computers when inspiration strikes or a bug needs fixing. tg-claude solves this by letting you control Claude Code through Telegram, Discord, or a web interface.

Key features:
-> Ralph Loop for autonomous task completion
-> Multi-platform: Telegram, Discord, Claude Hub web UI
-> Flexible AI: Claude, GLM, or 100+ models via OpenRouter
-> Easy deployment via Railway or Docker

Built with TypeScript, Bun, and the Anthropic Claude Agent SDK.

Check it out on Product Hunt: [Link]
```

### Discord/Slack Announcement
```
Hey everyone! Just launched tg-claude on Product Hunt

It's a bot that lets you control Claude Code remotely via Telegram or Discord (or web).

Features:
- /ralph command for autonomous coding loops
- Switch between Claude, GLM, or OpenRouter models
- MCP server & plugin support
- One-click deploy on Railway

Would love your support! [PH Link]
```

## Post-Launch

### Track Metrics
- Product Hunt upvotes and ranking
- GitHub stars gained
- New deployments (Railway analytics)
- Discord/Telegram community growth
- Social media engagement

### Follow Up
- [ ] Thank everyone who supported
- [ ] Respond to all remaining comments
- [ ] Address feature requests from feedback
- [ ] Write a launch retrospective blog post
- [ ] Update README with "Featured on Product Hunt" badge

### Product Hunt Badge
After launch, add this to your README:
```html
<a href="https://www.producthunt.com/posts/tg-claude?utm_source=badge-featured">
  <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=YOUR_POST_ID" alt="tg-claude on Product Hunt" />
</a>
```

## Resources

- [Product Hunt Launch Guide](https://www.producthunt.com/launch)
- [Best Practices for Makers](https://blog.producthunt.com/how-to-launch-on-product-hunt-7c1843e06399)
- [Example developer tool launches](https://www.producthunt.com/topics/developer-tools)
