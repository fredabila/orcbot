/**
 * DevelopmentHelper — Activated for software development, coding, and building tasks.
 * Provides professional engineering standards, project scaffolding guidance,
 * modern tooling awareness, and quality-focused development patterns.
 * 
 * This helper transforms the agent from "dump HTML into a file" into a
 * competent developer that creates properly structured, professional projects.
 */

import { PromptHelper, PromptHelperContext } from './PromptHelper';

export class DevelopmentHelper implements PromptHelper {
    readonly name = 'development';
    readonly description = 'Software development, coding, project scaffolding, modern tooling';
    readonly priority = 30;
    readonly alwaysActive = false;

    // Direct keyword signals — fast path
    private static readonly DEV_KEYWORDS: RegExp[] = [
        /\bbuild\b/i, /\bcreate a\b/i, /\bmake a\b/i, /\bdevelop\b/i, /\bcode\b/i,
        /\bprogram\b/i, /\bimplement\b/i, /\bwebsite\b/i, /\bweb app\b/i, /\bwebapp\b/i,
        /\bweb page\b/i, /\bwebpage\b/i, /\blanding page\b/i, /\bapp\b/i, /\bapplication\b/i,
        /\bdashboard\b/i, /\bportfolio\b/i, /\bblog\b/i, /\bplatform\b/i, /\bapi\b/i,
        /\bbackend\b/i, /\bfrontend\b/i, /\bserver\b/i, /\bdatabase\b/i, /\bscript\b/i,
        /\bbot\b/i, /\btool\b/i, /\bcli\b/i, /\blibrary\b/i, /\bpackage\b/i, /\bplugin\b/i,
        /\bhtml\b/i, /\bcss\b/i, /\bjavascript\b/i, /\btypescript\b/i, /\bpython\b/i,
        /\breact\b/i, /\bvue\b/i, /\bnode\b/i, /\bexpress\b/i, /\bnext\b/i, /\bvite\b/i,
        /\btailwind\b/i, /\bbootstrap\b/i, /\bproject\b/i, /\bscaffold\b/i,
        /\bboilerplate\b/i, /\btemplate\b/i, /\bstarter\b/i, /\bdeploy\b/i, /\bhost\b/i,
        /\bset up\b/i, /\bsetup\b/i, /\bconfigure a\b/i, /\bfix the code\b/i, /\brefactor\b/i,
        /\boptimize\b/i, /\bdebug\b/i, /\btest\b/i, /\bfeature\b/i, /\bcomponent\b/i,
        /\bmodule\b/i, /\bfunction\b/i, /\bclass\b/i, /\blogin page\b/i, /\bsignup\b/i,
        /\bform\b/i, /\bgallery\b/i, /\be-commerce\b/i, /\becommerce\b/i, /\btodo\b/i,
        /\bcalculator\b/i, /\bgame\b/i, /\bchat app\b/i, /\bclone\b/i
    ];

    // Regex patterns that catch creative/indirect phrasings — fallback path
    // Matches: "make me something", "whip up a tracker", "put together a site", 
    // "I need a thing that shows", "something to manage my X", etc.
    private static readonly DEV_PATTERNS: RegExp[] = [
        // Action verb + object creation: "build/make/whip up/put together/spin up/set up + a/an/the/my/some"
        /\b(build|make|create|develop|design|construct|craft|whip\s*up|put\s*together|throw\s*together|spin\s*up|set\s*up|wire\s*up|hook\s*up|stand\s*up|cook\s*up|knock\s*out|bang\s*out|crank\s*out|churn\s*out|scaffold|prototype|mock\s*up|sketch\s*out)\b.{0,30}\b(a|an|the|my|me|some|this|that|our)\b/i,
        // "I need/want/would like + a/an/something/a way to"
        /\b(i\s+need|i\s+want|i'd\s+like|i\s+would\s+like|can\s+you\s+make|could\s+you\s+make|can\s+you\s+create|could\s+you\s+build)\b.{0,40}\b(a|an|something|some\s+kind|a\s+way\s+to)\b/i,
        // "something that/to/which/for [verb]ing"
        /\bsomething\s+(that|to|which|for)\s+\w/i,
        // "a [noun] that/to/for [verb]" — catches "a tool that manages", "a page to show"
        /\ba\s+\w+\s+(that|to|for|which)\s+(show|display|manage|track|list|store|calculate|convert|organize|handle|process|monitor|visualize|present|render|generate|automate|integrate)/i,
        // File operation targets suggesting code generation: "write a script", "create a function"
        /\b(write|generate|produce)\s+(a|an|the|some|me\s+a)\s+(script|function|program|class|module|page|site|service|endpoint|route|handler|component|utility|helper|wrapper)/i,
        // "that looks (nice/good/clean/professional/modern)"
        /\bthat\s+looks?\s+(nice|good|clean|professional|modern|cool|sleek|polished|beautiful|amazing|pretty)\b/i,
        // Explicit deliverable nouns without action verbs: "I need a dashboard", "give me a landing page"
        /\b(give\s+me|get\s+me|hook\s+me\s+up\s+with|i\s+need)\s+(a|an)\s+\w*(site|page|app|tool|bot|script|tracker|manager|dashboard|portal|interface|system|platform|service)\b/i,
    ];

    shouldActivate(ctx: PromptHelperContext): boolean {
        const task = ctx.taskDescription.toLowerCase();
        // Fast path: direct keyword match
        if (DevelopmentHelper.DEV_KEYWORDS.some(rx => rx.test(task))) return true;
        // Slow path: regex pattern matching for creative phrasings
        if (DevelopmentHelper.DEV_PATTERNS.some(rx => rx.test(ctx.taskDescription))) return true;
        return false;
    }

    getRelatedHelpers(ctx: PromptHelperContext): string[] {
        const related = ['tooling']; // Development always needs tooling
        const task = ctx.taskDescription.toLowerCase();
        if (task.includes('website') || task.includes('web') || task.includes('page')) {
            related.push('browser');
        }
        if (task.includes('research') || task.includes('how to') || task.includes('best way')) {
            related.push('research');
        }
        return related;
    }

    getPrompt(ctx: PromptHelperContext): string {
        return `SOFTWARE DEVELOPMENT STANDARDS:

**PROJECT QUALITY BAR — NEVER ship amateur work:**
- When asked to "build" or "create" something, you are expected to deliver PROFESSIONAL-GRADE output.
- A single HTML file with inline styles is NEVER acceptable unless the user explicitly asks for "a simple HTML file".
- Default to modern, production-ready tech stacks and clean architecture.

**PROJECT SCAFFOLDING WORKFLOW:**
1. **Plan the architecture** before writing code. Think about: directory structure, tech stack, dependencies, build pipeline.
2. **Create a proper project directory** using \`create_directory\` — e.g., \`~/projects/my-app/\`
3. **Initialize the project** with appropriate tooling:
   - Web frontend: \`run_command("npm create vite@latest my-app -- --template react-ts", cwd)\` or similar
   - Node.js backend: \`run_command("npm init -y")\` then install deps
   - Python: \`run_command("python -m venv venv && source venv/bin/activate")\`
   - Static sites: At minimum use Tailwind CSS or a CSS framework
4. **Install dependencies** via \`run_command\` (npm install, pip install, etc.)
5. **Write source files** with \`write_file\` — proper separation of concerns (components, styles, utilities, configs)
6. **Test it** — run \`run_command\` to build/start/test and verify it works
7. **Deliver** — either send the project path or deploy it, depending on user intent

**TECH STACK DEFAULTS (use these unless user specifies otherwise):**
- **Web app/website**: Vite + React + TypeScript + Tailwind CSS (or vanilla HTML/CSS/JS with Tailwind CDN for simpler projects)
- **API/backend**: Node.js + Express + TypeScript (or Python + FastAPI)
- **Full-stack**: Vite React frontend + Express API backend
- **Static landing page**: HTML + Tailwind CSS CDN + modern design patterns
- **Scripts/utilities**: TypeScript or Python with proper error handling
- **CLI tools**: Node.js with commander or Python with argparse

**DESIGN & UI STANDARDS:**
- Modern, clean design with proper spacing, typography, and color schemes
- Responsive design (mobile-first) — ALWAYS
- Dark mode support when building web UIs
- Proper font loading (Google Fonts or system fonts)
- Semantic HTML elements (nav, main, section, article, footer)
- CSS custom properties for theming
- Smooth transitions and micro-interactions
- Accessible (proper ARIA labels, contrast ratios, keyboard navigation)
- NEVER use default browser styling without customization — always apply a design system

**CODE QUALITY:**
- Proper file/folder structure — NOT everything in one file
- Separation of concerns (logic, presentation, data)
- Meaningful variable/function names
- Error handling and edge cases
- Comments on complex logic (not obvious code)
- Use .gitignore, README.md, package.json properly
- Environment variables for configs/secrets (not hardcoded)

**MULTI-FILE PROJECT EXECUTION:**
When creating multi-file projects, work systematically:
1. Create the project root and subdirectories first
2. Write config files (package.json, tsconfig.json, vite.config, tailwind.config, etc.)
3. Write source files from outer (layout/app) to inner (components/utilities)
4. Install dependencies
5. Build/verify — run the build command and check for errors
6. If build fails, read the error, fix the file, rebuild
7. Do NOT stop at "files created" — verify the project actually builds/runs

**DELIVERY EXPECTATIONS:**
- If the user wants a website → build it, verify it runs, tell them how to access it (or deploy it)
- If the user wants a script → write it, test it, show the output
- If the user wants an API → build it, start it, test an endpoint
- NEVER just create files and say "done" without verifying they work
- If you can start a dev server (\`npm run dev\`, \`python -m http.server\`), do it and provide the URL

**ITERATIVE IMPROVEMENT:**
- After the initial build works, review the output critically
- Is the design actually good? Would a professional ship this?
- Are there obvious UX improvements?
- Does it handle edge cases (empty states, loading, errors)?
- If not, make a second pass to polish before delivering`;
    }
}
