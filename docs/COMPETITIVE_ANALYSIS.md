# ApplyPilot: Competitive Analysis (October 2026)

> **Scope.** This doc compares ApplyPilot v1.1.0 (Windows desktop app, Electron, local-first, Claude BYOK) and its planned companion mobile PWA with the job-application products a job seeker finds in October 2026. The PWA design runs job search server-side on public data and keeps user data end-to-end encrypted. The doc covers what competitors do, where ApplyPilot is ahead, what it lacks, and what to build next.
>
> **Method.** We ran the searches a job seeker would type ("websites which will apply for jobs automatically", "best AI job application bot 2026", "auto apply jobs India", "AI job search copilot") and read vendor feature pages, help centers, app-store listings, GitHub repos and third-party reviews. Research date: **4 Oct 2026**. **All prices are as of Oct 2026 and change often.** Many "reviews" in this market are published by competing vendors (Resumly, FastApply, LoopCV, JobCopilot, JobHire, Jobright and Scale.jobs all run review blogs about each other). We used vendor primary sources where we could and treat vendor-blog claims about rivals as indicative only. Earlier market context is in [MARKET_RESEARCH.md](MARKET_RESEARCH.md).
>
> **Legend:** ✅ yes · ⚠️ partial, limited, beta or paid-only · ❌ no · ? not publicly documented

---

## 0. TL;DR

- **ApplyPilot is not unique on any single feature.** Local-first plus BYOK exists (RONIN, career-ops with ~73k GitHub stars, Apply Aide, ApplyEase). Parallel resume "loops" with A/B testing exist (LoopCV). Per-company caps exist (Adzuna ApplyIQ). "Never guess" exists (Simplify Autopilot, myjobb). Proof screenshots exist (Scale.jobs).
- **The combination is unique.** No other product we found pairs these:
  1. A packaged, no-account desktop GUI.
  2. Multi-source discovery from free public ATS APIs.
  3. Deterministic per-ATS adapters that submit from the user's own browser and residential IP.
  4. A hard ToS line: auto-submit only on six ATSs, assisted mode on LinkedIn, Indeed and Naukri.
  5. Parallel role campaigns, a review-first queue, answer memory and proof screenshots.
  6. Non-renewing pricing.
- **The biggest gaps vs. paying-customer expectations:**
  1. No **per-job tailored resume file**. Today the app only suggests rewrites; most auto-appliers generate a tailored PDF.
  2. No **mobile** surface. Jobright, Simplify, Sorce, Oaki and Massive all have apps.
  3. No **email-based status tracking** (Simplify has Gmail sync).
  4. No **browser extension** for saving and autofilling jobs found elsewhere.
  5. Nothing runs **while the PC is off**.
  6. No **networking or referral** layer.
  7. No **voice mock interviews**.
- **The planned PWA is the best lever.** Our main moat is that applications come from the user's own browser and identity and never from our servers. If the phone becomes an end-to-end-encrypted remote control for the desktop agent (approve, answer, pause), ApplyPilot gets a cloud tool's convenience and keeps that moat. No competitor offers E2E-encrypted sync.

---

## 1. Who is in the market (Oct 2026)

### 1.1 Market map

| Segment | Products |
|---|---|
| Cloud autopilots (apply from vendor servers) | JobCopilot, LoopCV, AIApply, Massive, Sonara (BOLD), JobHire.ai, Resumly, ApplyPass, BulkApply, ApplyCove, myjobb, Scout by AgentCo, Adzuna ApplyIQ, Tsenta, Careerswift |
| Browser-extension autofill / copilots (apply from the user's browser) | Simplify Copilot (+ Autopilot beta), Jobright extension, LazyApply, FastApply, JobWizard, Oaki extension, AutoApplier, Huntr/Teal/Careerflow autofill, Apply Aide (BYOK) |
| Mobile swipe-to-apply | Sorce (iOS), Wobo, FastApply Swipe mode, Oaki (iOS) |
| Local / desktop / open source | **ApplyPilot**, RONIN (desktop, on-device AI), career-ops (OSS, runs in Claude Code/Codex), JobPilot (OSS), ai-job-search (OSS), Applyocalypse (OSS Electron), ApplyEase (OSS desktop), AIHawk (OSS) |
| Review-first "quality" auto-apply | Jobscan Auto Apply (launched 10 Jun 2026), Oaki, FastApply Copilot mode |
| Human-powered services | Scale.jobs |
| Trackers, resume and interview suites (no auto-submit) | Teal, Huntr, Careerflow, Jobscan, Rezi, Kickresume, Enhancv, Hiration, Resume Worded, WonsultingAI, Swooped, EarnBetter (EarnIn), Final Round AI, HiringCafe (search only) |
| Platform-native AI | LinkedIn Premium Apply Assistant (rolling out since 24 Jun 2026), LinkedIn AI job search and Job Match, Indeed Career Scout, Naukri Pro AI Resume Maker, ChatGPT Jobs (in testing) |

### 1.2 Product catalogue (37 products)

| # | Product | Platform | Price (as of Oct 2026) | Auto-apply approach | Boards / coverage | Notable features | Top complaints | Sources |
|---|---|---|---|---|---|---|---|---|
| 1 | **Simplify** | Chrome/Safari extension, web, iOS app | Free autofill + tracker; Simplify+ ≈ $19.99/wk or $39.99/mo | Copilot autofills, you submit. **Autopilot** (beta, select Simplify+ members, weekly credits) submits unattended and "fails the application rather than guess" | 100+ ATS incl. Workday, iCIMS, Taleo; "100,000+ company career sites" | Gmail integration with suggested status updates, Network Copilot, referrals, AI email, auto-tailored resume and cover letter | Autofill ~40–50% on iCIMS/Taleo; tailoring paywalled; Autopilot gated | [Autopilot help](https://help.simplify.jobs/articles/1784339-getting-started-with-autopilot), [Email integration](https://help.simplify.jobs/articles/0236686-email-integration), [Help center](https://help.simplify.jobs/), [FastApply comparison](https://blog.fastapply.co/auto-apply-jobs-tools-compared-2026) |
| 2 | **Jobright.ai** | Web, Chrome extension, iOS + Android | Free tier; Turbo $39.99/mo, $17.99/wk, $89.98/qtr; no public pricing page | Autofill extension; "Agent" auto-apply is **waitlisted**, with a paid "skip waiting" button | US jobs only; Workday, Greenhouse, Lever, iCIMS, Ashby, Workable | Orion chat copilot, Insider Connections, H-1B filter, fraud detection, job alerts app | Billing and cancellation in ~72% of 1-star reviews; tailoring fabricated a skill ("Go"); agent not available | [Jobity review, Sep 2026](https://jobity.io/blog/jobright-review), [jobright.ai](https://jobright.ai/), [App Store](https://apps.apple.com/us/app/jobright-ai-job-search/id6738236788), [Wobo review](https://www.wobo.ai/blog/jobright-review/) |
| 3 | **JobCopilot** | Cloud + extension | Premium from $0.93/day (1 copilot, 20/day); Elite from $1.05/day (3 copilots, 50/day); weekly, monthly or quarterly | Cloud agent searches every ~2 h and applies automatically or autofills for review | "500,000+ company career pages" | Learns from your answer edits, hiring-manager email credits (Elite), mock interviews, tracker | Users report scam and ghost postings (5 of 40 in one Reddit post), irrelevant matches, double charges, Workday failures, applications cannot be withdrawn | [jobcopilot.com](https://jobcopilot.com/), [pricing](https://jobcopilot.com/pricing/), [Resumly review](https://www.resumly.ai/answers/jobcopilot-review), [JobHire review](https://jobhire.ai/blog/jobcopilot-review) |
| 4 | **LazyApply** | Chrome extension + dashboard | $99/yr (15/day), $149/yr (150/day), $999/yr (1,500/day); no free tier | Mass autofill and submit from the extension, no tailoring | Site lists Greenhouse, Dice, Indeed, ZipRecruiter | "Smart referral emails" auto-sent to employees, Job GPT, many generators | Generic submissions, wrong screening answers, refund limits, LinkedIn restrictions | [lazyapply.com](https://lazyapply.com/), [FastApply comparison](https://blog.fastapply.co/auto-apply-jobs-tools-compared-2026) |
| 5 | **LoopCV** | Cloud web app + extension | Free (10/mo); Standard €8.99/mo (100); Premium €29.99/mo (300 + AI answers); Done-For-You €87.99/mo | Server-side "loops" (saved searches) auto-apply via forms, ATS or recruiter email; runs with the computer off | "LinkedIn, Indeed, Glassdoor and many others", 30+ boards | Multiple concurrent loops, **CV A/B testing with open and reply stats**, automated recruiter emails, company exclusions | No resume rewriting, unreviewed applications, niche-title match quality; Trustpilot 3.9 (Oct 2026) | [LoopCV auto-apply](https://www.loopcv.pro/autoapply/), [FastApply review](https://blog.fastapply.co/is-loopcv-legit-2026-review), [loopcv.pro](https://www.loopcv.pro/) |
| 6 | **AIApply** | Web | No public pricing; Pro ≈ $29/mo for writing tools; auto-apply is separate credits (≈ $49/100) | Cloud: match, generate tailored resume and cover letter, submit | "Trusted domains" (not listed) | Interview Buddy (live), mock interviews, non-expiring credits | Dual pricing surprises, BBB F, Trustpilot integrity warning, applications to jobs "in languages I don't speak", OTP/login walls fail | [aiapply.co/auto-apply](https://aiapply.co/auto-apply), [Resumly review](https://www.resumly.ai/answers/aiapply-review), [Scoutify test](https://scoutify.com/blog/aiapply-review/) |
| 7 | **FastApply** | Extension + hosted automation (+ mobile swipe) | Free 5 apps; $14/mo (200), $29 (500), $49 (1,000) | Four modes: **Copilot** (pause for review), Full Autonomous, **Stealth** (background), **Swipe** | 20+ incl. LinkedIn, Indeed, Naukri, Workday, Greenhouse, Lever, Ashby, BambooHR, Jobvite | **Publishes completion rates**: Workday 44.5%, LinkedIn 61.4% of 11,906 attempts (Sep 2026), Dice 95.7% | "One in three started applications does not complete"; tailoring paid-only | [How it works](https://blog.fastapply.co/ai-auto-apply-for-jobs-how-it-works-2026), [Four modes](https://fastapply.co/ai-auto-apply) |
| 8 | **myjobb** (India) | Web + extension; server-side | Free (feed / 10 apps); Plus ₹499/mo (100); Pro ₹1,999/mo (unlimited + cold email); UPI, **no auto-renewal** | Captures your portal session cookie (AES-256-GCM) and submits **server-side** as you | Naukri, Foundit, Hirist, Instahyre + Workday, Greenhouse, Ashby, Lever, SuccessFactors, iCIMS | Daily cap 1–25, score floor, pauses on low-confidence answers, LaTeX PDF tailoring, **9 AM daily report** with one-click retry | Automates portals whose ToS forbid it (see Naukri §6 in MARKET_RESEARCH) | [Auto-apply page](https://myjobb.ai/features/auto-apply), [India tools blog](https://myjobb.ai/blog/best-tool-auto-apply-jobs-india) |
| 9 | **RONIN** | Native desktop (Windows 10+, macOS Apple Silicon) | **$49 one-time**, unlimited; 20-app free trial | Computer vision "sees your screen"; works "on any job site"; handles simple CAPTCHAs | Any site; discovery plugin for LinkedIn only | ~8 GB on-device AI model, no cloud account or API key, isolated Chrome profile, tailored headline/summary/skills PDF | No ToS or ban guidance on its site; solves CAPTCHAs; no tracker or campaign features shown | [roninapply.com](https://roninapply.com/) |
| 10 | **career-ops** (OSS) | Runs inside Claude Code / Codex / OpenCode | Free (MIT) + your AI subscription | Scans, scores (1–5, A–H report), tailors PDF, **fills but never submits** | 55+ providers incl. Ashby, Greenhouse, Lever, Wellfound; 100+ preset companies | Legitimacy checks (repost detection, sponsorship flags), comp research, interview prep, TUI dashboard, batch evaluation; ~73k stars | Needs a CLI and an AI subscription; no GUI installer | [GitHub](https://github.com/santifer/career-ops) |
| 11 | Massive (UseMassive) | Web + iOS | ≈ $59/mo or ≈ $50/mo quarterly (reported; earlier $49/$99 tiers) | Cloud autopilot, "shows you exactly what gets submitted" | Claims 2M+ jobs incl. Workday, iCIMS | Visa-sponsorship filter, messages to hiring teams, claims employers "cannot detect" submissions | Trustpilot ~1.8–2.3; failed on 9 of 19 sites in one test; invented resume details; refund terms | [usemassive.com](https://usemassive.com/), [Jobara review](https://jobara.ai/blog/use-massive-review), [LoopCV directory](https://www.loopcv.pro/directory/massive/) |
| 12 | Sorce | iOS app (YC F25) | Free **40 swipes/day with AI auto-apply**; paid raises caps | Swipe right and the agent applies on the company career site | Company career sites | Tinder-style UX, tailored cover letter; 850K+ users, 1M+ applications | Mixed match quality and filters | [Pricing](https://www.sorce.jobs/articles/sorce-pricing), [Ace review](https://aceapp.ai/blog/sorce-review) |
| 13 | Wobo | Web/mobile | Unlimited $34.99/mo; Autopilot $44.99/mo (5-day trial) | Swipe-to-apply or Autopilot | North America and Europe | Swipe UX | Resume import parsing, generic letters, no extension | [JobHire on Wobo](https://jobhire.ai/blog/wobo-ai-review), [Toolworthy](https://www.toolworthy.ai/tool/wobo) |
| 14 | Oaki | Web, Chrome extension, iOS | Free 20 credits/wk; $50 one-time | Auto-apply at "the best time of day"; review and edit any field | ? | Hybrid (RRF) job search, per-job resume themes, "no spray and pray" | New, credit-based | [Oaki blog](https://www.oaki.io/blog/best-auto-apply-tools-2026), [App Store](https://apps.apple.com/us/app/oaki/id6751103290) |
| 15 | Resumly | Web | Free 10 auto-applies; $30/$60/$100/mo (360/900/1,800 apps), half price yearly | Agent submission with tailored resume and cover letter | ? | Reads recruiter replies and advances the pipeline automatically | Vendor-authored rankings put itself #1 | [Resumly best-of](https://www.resumly.ai/best/best-ai-auto-apply-tools) |
| 16 | JobHire.ai | Web (done-for-you) | $49/mo, $119/3 mo, $199/6 mo; prices only after signup; no trial | Cloud AI agent applies | ? | Hands-off | BBB F (Mar 2026), irrelevant applications, no submission log | [Dreamwork](https://www.dreamworkhq.com/blog/jobhire-ai-review), [LoopCV blog](https://blog.loopcv.pro/jobhire-review/) |
| 17 | Sonara (BOLD) | Web | $2.95 14-day trial → $23.95 per 4 weeks; ≈ $71.40/yr; **no pricing page** | Cloud autopilot, editable queue | ? | Relaunched by BOLD (Zety); live since Jun 2026 | 2024 shutdown stranded users; poor matching | [Dreamwork status check](https://www.dreamworkhq.com/blog/sonara-ai-review), [Jobloo](https://jobloo.co/blog/sonara-ai-review-2026/) |
| 18 | Adzuna ApplyIQ | Web (Adzuna) | Free | Applies on your behalf to Adzuna-matched roles; no preview | Adzuna's 8M+ jobs (US/UK) | **Never applies to previous employers; ≤ 2 per company per 60 days**; never rewrites your resume; ~5 apps/week | No preview, no tailoring | [ApplyIQ](https://www.adzuna.com/apply-iq), [FastApply comparison](https://blog.fastapply.co/auto-apply-jobs-tools-compared-2026) |
| 19 | Jobscan Auto Apply | Web | Premium $49.95/mo incl. 2 credits/mo; packs $1.40–$1.70 per credit | Drafts every answer from your resume; **review by default**, opt-in auto-submit | Greenhouse, Lever, Workable + 20 ATS | ATS-optimisation brand | Credit math is expensive | [jobscan.co/auto-apply](https://www.jobscan.co/auto-apply), [Jobscan vs JobCopilot](https://www.jobscan.co/blog/jobscan-vs-jobcopilot/) |
| 20 | Scale.jobs | Human assistants + dashboard | $199 (250 apps), $299 (500), $399 (1,000) one-time; first 5 free | Humans tailor and submit | Any portal | **Time-stamped screenshot proof via WhatsApp** | Expensive; vendor-reported callback rates | [Scale.jobs comparison](https://scale.jobs/blog/best-job-application-services-comparison) |
| 21 | ApplyCove (India) | Cloud + extension | ₹349 / ₹799 / ₹1,299 per month (runtime minutes/day) | Cloud sessions on Naukri and LinkedIn; caps 50–200/day | Naukri, LinkedIn | Remembers edited CTC, notice-period and relocation answers | Volume-oriented; ToS risk | [applycove.com](https://applycove.com/) |
| 22 | Scout by AgentCo (India) | Web, extension, **Claude Code plugin**, Copilot CLI plugin | Free discovery; ₹299/session; ₹599/mo | Overnight applications; local tailoring via Claude Code plugin | Naukri, iimjobs, Hirist, LinkedIn, Indeed, 19 countries | Local-privacy tailoring option | New | [AgentCo blog](https://agentco.in/blog/best-ai-job-search-tools-india-2026) |
| 23 | Teal | Web + Chrome extension | Free tracker; Teal+ ≈ $9–13/wk, $29/mo, $79/qtr | **No auto-apply** | Saves from 50+ boards | Best-in-class tracker, resume builder, match scorer, LinkedIn review | Charged after cancelling; slow support | [Resumly on Teal](https://www.resumly.ai/answers/teal-review), [LoopCV blog](https://blog.loopcv.pro/teal-hq-review/) |
| 24 | Huntr | Web + extension | Free (100 jobs, 2 tailored resumes); Pro $40/mo, $30/mo qtr, $26.66/mo 6-mo | Autofill only | Any (extension) | Unlimited contacts and autofills free, tracker | Pricey for a tracker | [huntr.co/pricing](https://huntr.co/pricing) |
| 25 | Careerflow | Web + extension | Premium $23.99/mo; Premium Plus $44.99/mo (mock interviews) | Autofill only | LinkedIn and boards | LinkedIn optimizer, ATS scorer, mock-interview analysis | Autofill breaks on JS-heavy forms | [Remote Job Assistant](https://www.remotejobassistant.com/blog/careerflow-review) |
| 26 | Final Round AI | Web/desktop copilot | $90/mo, $60/mo qtr, $25/mo yearly; "Job Hunter" auto-apply is a separate subscription | Separate product | n/a | Real-time interview copilot, 90+ languages | Price; interviewer detection risk | [InterviewMan](https://interviewman.com/compare/final-round-ai), [LoopCV directory](https://www.loopcv.pro/directory/finalround/) |
| 27 | JobWizard | Chrome extension | Free; paid tier | Autofill only, never auto-submits | Workday, Greenhouse, iCIMS, Lever, Ashby, SmartRecruiters, Taleo, 500+ | 0–100 match score, autofill log | — | [jobwizard.ai](https://jobwizard.ai/) |
| 28 | HiringCafe | Web | Free | None (search only) | 3.59M jobs from 116k company career pages (Jun 2026) | Most precise filters, no Easy Apply spam | Crawls 2×/day, ~35% of US jobs, no alerts, no app | [Dreamwork](https://www.dreamworkhq.com/blog/hiring-cafe-review), [ResumeUp](https://resumeup.ai/blog/hiringcafe-review) |
| 29 | EarnBetter (EarnIn) | Web/app | Free (employer-funded) | None (application packs) | Own matches | Resume rewrite, cover letter, interview cheat sheet; acquired by EarnIn 2026 | Generic output | [Dreamwork](https://www.dreamworkhq.com/blog/earnbetter-review) |
| 30 | Swooped | Web | Free; $39/mo or $12/mo yearly | None | Aggregated board | Resume grader, tailoring | Stale reposted jobs | [LoopCV directory](https://www.loopcv.pro/directory/swooped/) |
| 31 | Jobsolv | Web | Free + passes + Pro | **Pivoted away from auto-apply (Jul 2026)**; now resume and ATS only | — | Evidence-based rewrite | — | [LoopCV directory](https://www.loopcv.pro/directory/jobsolv/) |
| 32 | WonsultingAI | Web | Free Starter; Premium $19.99/mo | None | — | Networking scripts, JobTrackerAI | Caps | [Wonsulting](https://www.wonsulting.com/jobtrackerai) |
| 33 | AutoApplier | Chrome extension | Subscription (not published) | LinkedIn Easy Apply automation | LinkedIn | — | 3.9★ (42 ratings) | [Chrome Web Store](https://chromewebstore.google.com/detail/linkedin-autoapplier/niphbnpodnkchmifkcpoohlakeofljam) |
| 34 | Apply Aide | Extension | ? | Autofill with **BYOK** (OpenAI, Anthropic, Gemini, DeepSeek), keys in encrypted local storage | Any | BYOK | Small | [Privacy page](https://applyaide.com/privacy) |
| 35 | JobPilot (OSS) | Local, runs on Claude Code/Codex | Free (MIT) | Submits within caps from a real local browser; reads Gmail replies; push notifications for items that need you | LinkedIn, Indeed, Hiring Cafe, custom; Upwork | Inbox sync, recruiter messages | Small (81★); LinkedIn ToS risk | [GitHub](https://github.com/suxrobgm/jobpilot) |
| 36 | LinkedIn Premium Apply Assistant | LinkedIn (Premium) | Included in Premium | Pre-fills fields, drafts letters, **per-section confidence indicators**; works on LinkedIn **and external roles**; user approves | LinkedIn + external | Platform-native, no ToS risk | Gradual rollout; Premium only | [Social Media Today, 24 Jun 2026](https://www.socialmediatoday.com/news/linkedin-automates-job-application-process-for-premium-users/823719/), [Jobsistant guide](https://www.jobsistant.com/guides/linkedin-2026-ai-changes) |
| 37 | Indeed Career Scout | Indeed web + app | Free | No apply-for-you; drafts you review | Indeed | Career discovery quiz, resume tailoring, mock interviews, salary and company insights | Indeed-only, US-focused | [Indeed](https://www.indeed.com/career-advice/finding-a-job/what-is-indeed-career-scout) |

**Also seen but not profiled:** Tsenta, ApplyPass, BulkApply, ApplyBlast, ApplyHero, iApply, AutoJob, Careerswift, ScoutBetter, Lensa, Rezi, Kickresume, Enhancv, Hiration, Resume Worded, Novoresume, Zety, Career.io, Sensei AI ([LoopCV directory](https://www.loopcv.pro/directory/), [Valasys ranking](https://valasys.com/top-10-ai-tools-for-automated-job-applications-tested-and-ranked/)); Naukri Pro AI Resume Maker, ₹1,999/3 months ([Business Standard](https://www.business-standard.com/content/press-releases-ani/naukri-launches-ai-powered-resume-maker-to-help-job-seekers-build-professional-recruiter-ready-cvs-effortlessly-125112100431_1.html)); ChatGPT Jobs, still in internal testing with no autofill or tracker ([Careerflow, Sep 2026](https://www.careerflow.ai/blog/chatgpt-jobs-feature)).

**Status changes worth knowing:** Sonara shut down in Feb 2024 and BOLD relaunched it (live since Jun 2026). Jobsolv dropped auto-apply (Jul 2026). Jobright's Agent is still waitlisted (Sep 2026). EarnBetter was acquired by EarnIn (2026). Jobscan entered auto-apply (Jun 2026). LinkedIn is retiring classic job search from Sep 2026 in favour of AI search ([Jobsistant](https://www.jobsistant.com/guides/linkedin-2026-ai-changes)).

---

## 2. Feature matrix: ApplyPilot vs. the 10 most relevant competitors

**Why these 10:** the most-recommended US auto-appliers (Simplify, Jobright, JobCopilot, LazyApply, LoopCV, AIApply, FastApply), the leading India auto-applier (myjobb), and the two closest architectural rivals: RONIN (local desktop) and career-ops (local, open source, Claude-based).

Abbreviations: **AP** ApplyPilot v1.1 · **Simp** Simplify · **JR** Jobright · **JC** JobCopilot · **Lazy** LazyApply · **Loop** LoopCV · **AIA** AIApply · **Fast** FastApply · **myj** myjobb · **RON** RONIN · **c-ops** career-ops

| # | Feature | AP | Simp | JR | JC | Lazy | Loop | AIA | Fast | myj | RON | c-ops |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | **Platform & pricing** | | | | | | | | | | | |
| 1 | Primary platform | Win desktop | Ext + web + iOS | Web + ext + apps | Cloud + ext | Ext | Cloud + ext | Web | Ext + cloud | Cloud + ext | Desktop | CLI |
| 2 | Entry paid price | $12/mo; $29/90 days; $149 lifetime | $39.99/mo | $39.99/mo | ≈ $0.93/day | $99/yr | €8.99/mo | ≈ $29/mo + credits | $14/mo | ₹499/mo | $49 once | Free |
| 3 | Useful free tier | ✅ 10/day, assisted | ✅ autofill | ✅ matching | ❌ | ❌ | ✅ 10/mo | ⚠️ | ✅ 5 apps | ✅ | ⚠️ 20-app trial | ✅ OSS |
| 4 | Non-renewing / one-time option | ✅ Sprint, Lifetime | ❌ | ❌ | ❌ | ⚠️ annual | ❌ | ⚠️ credits | ❌ | ✅ no auto-renew | ✅ | n/a |
| 5 | Public price list | ✅ | ✅ | ❌ | ⚠️ per-day | ✅ | ⚠️ inconsistent | ❌ | ✅ | ✅ | ✅ | n/a |
| | **Discovery** | | | | | | | | | | | |
| 6 | Multi-source aggregation | ✅ 25+ sources | ✅ own board | ✅ US only | ✅ 500k sites | ⚠️ on-board | ✅ 30+ boards | ? | ✅ 20+ | ✅ India 50k/day | ⚠️ LinkedIn plugin | ✅ 55+ providers |
| 7 | Direct company ATS feeds | ✅ 729 boards, 6 ATS APIs | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ? | ✅ | ✅ | ✅ any (vision) | ✅ |
| 8 | Indian portals (Naukri etc.) | ⚠️ deep links + assisted fill | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ Naukri listed | ✅ 4 portals | ⚠️ any site | ? |
| 9 | Natural-language / chat search | ❌ | ? | ✅ Orion | ❌ | ❌ | ❌ | ? | ? | ? | ? | ✅ in CLI |
| 10 | Visa-sponsorship filter | ❌ (answers only) | ? | ✅ H-1B | ? | ❌ | ? | ? | ? | ❌ | ❌ | ⚠️ flags |
| 11 | Ghost-job / scam flags | ✅ heuristics | ? | ✅ fraud detection | ⚠️ claims verified; scams reported | ❌ | ❌ | ❌ | ? | ? | ❌ | ✅ repost detection |
| 12 | Explainable match score | ✅ 5-factor breakdown | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | ✅ | ? | ✅ score floor | ? | ✅ A–H report |
| 13 | Missing-keyword / skills gap | ✅ | ⚠️ paid | ✅ | ❌ | ⚠️ tool | ⚠️ CV checker | ✅ | ✅ | ✅ | ❌ | ✅ |
| 14 | Salary / comp insight | ⚠️ posting salary only | ? | ? | ❌ | ❌ | ⚠️ shows salary | ❌ | ? | ⚠️ CTC fields | ❌ | ✅ comp research |
| 15 | Job alerts / push | ⚠️ Windows toasts | ✅ app | ✅ app | ✅ | ❌ | ✅ email | ? | ? | ✅ 9 AM report | ❌ | ❌ |
| | **Applying** | | | | | | | | | | | |
| 16 | Autofill, user submits | ✅ assisted mode | ✅ core | ✅ | ✅ review mode | ⚠️ | ✅ one-click | ? | ✅ Copilot | ⚠️ | ? | ✅ never submits |
| 17 | Unattended auto-submit | ✅ 6 ATSs, paid | ⚠️ Autopilot beta | ⚠️ waitlisted | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ by design |
| 18 | Review-first queue (default) | ✅ | ⚠️ Copilot only | ⚠️ | ⚠️ optional | ❌ | ⚠️ | ⚠️ | ✅ Copilot mode | ⚠️ caps only | ❌ | ✅ |
| 19 | Keeps working with the PC off | ❌ | ✅ Autopilot | ⚠️ | ✅ | ❌ | ✅ | ✅ | ✅ Stealth | ✅ | ❌ | ❌ |
| 20 | Submits from the user's own browser and IP | ✅ | ⚠️ Copilot yes, Autopilot no | ⚠️ ext | ❌ cloud | ✅ | ⚠️ | ❌ | ⚠️ mixed | ❌ server with your cookie | ✅ | ✅ |
| 21 | Workday | ⚠️ assisted, page by page | ✅ autofill | ✅ | ⚠️ breaks reported | ❌ | ? | ? | ⚠️ 44.5% completion | ✅ claimed | ✅ claimed | ⚠️ |
| 22 | LinkedIn / Indeed automation | ❌ by design (assisted) | ❌ | ❌ | ❌ | ⚠️ Indeed | ✅ LinkedIn ext | ? | ✅ 61% completion | ⚠️ "coming soon" | ✅ any site | ❌ |
| 23 | Screening-answer memory | ✅ answer bank + 13-section profile | ✅ saved responses | ? | ✅ learns from edits | ⚠️ bad defaults reported | ✅ Premium AI | ? | ? | ✅ | ? | ✅ |
| 24 | Pause on unknown (never guess) | ✅ | ✅ Autopilot fails safe | ? | ? | ❌ | ⚠️ questions tab | ? | ✅ Copilot | ✅ low-confidence pause | ? | ✅ |
| 25 | Per-company cap + cross-source dedupe | ✅ ≤ 2 / 30 days | ? | ? | ? | ❌ | ⚠️ exclusions | ? | ? | ? | ? | ⚠️ |
| 26 | Configurable daily caps | ✅ plan, user, campaign | ⚠️ credits | ? | ✅ 20/50 | ✅ plan | ✅ credits | ? | ✅ | ✅ 1–25 | ? | n/a |
| 27 | Parallel campaigns / profiles | ✅ up to 10, own resume each | ❌ | ❌ | ✅ 1–3 copilots | ✅ 1–20 profiles | ✅ loops | ? | ? | ? | ? | ⚠️ batch eval |
| 28 | Multiple resumes, auto-picked per job | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ profiles | ✅ per loop | ? | ? | ? | ? | ⚠️ |
| 29 | **Per-job tailored resume file** | ❌ suggestions only | ✅ paid | ✅ (fabrication reports) | ⚠️ Elite | ❌ | ❌ | ✅ | ✅ paid | ✅ LaTeX PDF | ✅ PDF | ✅ PDF |
| 30 | Per-job cover letter | ✅ BYOK | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | ✅ | ✅ | ? | ? | ✅ |
| 31 | Anti-fabrication guard (verifier/diff) | ⚠️ prompt only | ? | ❌ | ? | n/a | n/a | ? | ? | ? | ? | ⚠️ human review |
| 32 | Proof of each submission | ✅ screenshots | ⚠️ Autopilot tab | ? | ⚠️ dashboard | ⚠️ | ⚠️ | ? | ⚠️ dashboard | ⚠️ report | ? | ⚠️ files |
| 33 | Swipe / quick-triage UX | ❌ (bulk approve) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ Swipe | ❌ | ❌ | ❌ |
| | **After applying** | | | | | | | | | | | |
| 34 | Kanban tracker | ✅ | ✅ | ✅ | ✅ | ⚠️ analytics | ✅ | ✅ | ✅ | ⚠️ | ? | ✅ TUI |
| 35 | Email sync → status updates | ❌ | ✅ Gmail | ? | ? | ❌ | ⚠️ opens/replies on its own emails | ? | ? | ? | ❌ | ❌ |
| 36 | Follow-up reminders | ✅ | ? | ? | ⚠️ HM emails | ❌ | ⚠️ | ? | ? | ? | ❌ | ? |
| 37 | Outcome analytics / resume A/B | ✅ per-resume interview rate | ❌ | ❌ | ❌ | ⚠️ | ✅ CV A/B | ❌ | ? | ❌ | ❌ | ⚠️ rejection patterns |
| 38 | Data export / delete-all | ✅ CSV, JSON, wipe | ? | ? | ? | ? | ? | ? | ? | ? | ✅ local | ✅ files |
| | **Networking & interviews** | | | | | | | | | | | |
| 39 | Referral / insider finder | ⚠️ drafts message only | ✅ Network Copilot | ✅ Insider Connections | ⚠️ | ✅ auto referral emails | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 40 | Recruiter / HM outreach | ⚠️ drafts | ✅ AI email | ✅ templates | ✅ email credits | ✅ sends | ✅ sends | ❌ | ❌ | ✅ cold email (Pro) | ❌ | ⚠️ drafts |
| 41 | Interview prep pack | ✅ BYOK | ? | ✅ | ✅ | ⚠️ | ✅ | ✅ | ? | ? | ❌ | ✅ |
| 42 | Voice mock interview | ❌ | ❌ | ⚠️ | ✅ | ❌ | ✅ | ✅ | ? | ? | ❌ | ❌ |
| | **Platform, privacy, trust** | | | | | | | | | | | |
| 43 | Mobile app | ❌ (PWA planned) | ✅ iOS | ✅ iOS + Android | ? | ❌ | ? | ? | ⚠️ swipe web | ❌ | ❌ | ❌ |
| 44 | Browser extension | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ? | ✅ | ✅ | ❌ | ❌ |
| 45 | Data local, no account needed | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| 46 | BYOK / no AI markup | ✅ Claude | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ on-device model | ✅ own CLI plan |
| 47 | E2E-encrypted cloud sync | ❌ (planned) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (server-held keys) | ❌ | ❌ |
| 48 | Explicit ToS-safe automation policy | ✅ allow-list in code | ⚠️ | ⚠️ | ⚠️ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ solves CAPTCHAs | ✅ never submits |

Sources for the matrix: §1.2 rows 1–10 plus the ApplyPilot [README](../README.md), [ARCHITECTURE.md](ARCHITECTURE.md) and `src/config.js`. A "?" means the vendor does not document the feature. It does not prove the feature is missing.

---

## 3. Where ApplyPilot is already unique (honest version)

Each claim names the closest competitor and explains why ApplyPilot still differs. Claims are ordered by how defensible they are.

1. **The only tool that combines unattended auto-submit with a hard ToS boundary enforced in code.** ApplyPilot auto-submits only on six allow-listed ATSs (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee). LinkedIn, Indeed, Naukri, Glassdoor and Workday are assisted-only (`AUTO_SUBMIT_ATS` / `ASSISTED_ATS` in `engine.js`).
   - **Who goes further:** LazyApply, LoopCV, FastApply, AutoApplier, ApplyCove, myjobb and RONIN all automate LinkedIn, Indeed or Naukri, whose terms forbid bots ([LinkedIn](https://www.linkedin.com/help/linkedin/answer/a1341387), [Indeed ToS](https://www.indeed.com/legal), [Naukri T&C](https://www.naukri.com/termsconditions)). RONIN also auto-solves CAPTCHAs ([roninapply.com](https://roninapply.com/)).
   - **Who stays further back:** career-ops never submits anywhere ([GitHub](https://github.com/santifer/career-ops)), and Jobscan submits only after you review each application ([Jobscan](https://www.jobscan.co/auto-apply)).
   - ApplyPilot sits in the safe-but-useful middle, and no other product positions itself there.

2. **Applications leave from the user's own browser, residential IP and identity, never from a vendor server.**
   - Greenhouse Real Talent (GA Feb 2026) has run 10.2M+ fraud checks and flags ~1 in 4 candidates. It uses phone, email, **IP and location** signals plus CLEAR identity verification ([HR Tech Edge, 24 Sep 2026](https://www.hrtechedge.com/hr/greenhouses-real-talent-targets-ai-era-hiring-fraud/), [Greenhouse](https://www.greenhouse.com/product-features/greenhouse-real-talent)).
   - Cloud autopilots apply from their own servers: JobCopilot, LoopCV, AIApply, FastApply Stealth, Sonara, ApplyCove, and myjobb, which submits server-side with a copy of your session cookie ([myjobb](https://myjobb.ai/features/auto-apply)).
   - Extensions (Simplify Copilot, LazyApply) and RONIN also use the user's machine. ApplyPilot is the only one of those that pairs local submission with multi-source discovery and campaigns.

3. **Zero vendor-held career data, with no account required for any feature, plus BYOK Claude at cost.**
   - RONIN (on-device model) and the OSS CLI projects (career-ops, JobPilot) share this.
   - Every commercial auto-applier with a tracker and campaigns stores resumes server-side: Simplify, Jobright, JobCopilot, LoopCV, AIApply, FastApply, myjobb.
   - ApplyPilot is the only **packaged GUI** product that combines local data, BYOK frontier-model tailoring (~$0.03–0.06 per tailored application on Sonnet 5.5; see MARKET_RESEARCH §3.3) and auto-submit. RONIN has no BYOK frontier model. career-ops has no installer, no GUI and no submit.
   - Sonara's 2024 shutdown, which "stranded users mid-search" ([Dreamwork](https://www.dreamworkhq.com/blog/sonara-ai-review)), is the cautionary tale this design avoids.

4. **One safety stack that rivals only offer in pieces.** ApplyPilot combines:
   - Per-company cap (≤ 2 per 30 days) across all campaigns.
   - Cross-source dedupe.
   - Never-guess with answer memory.
   - Review-first default.
   - Proof screenshots.
   - Dry-run mode that physically cannot submit.
   - Delete-all.

   Each piece exists somewhere else: ApplyIQ caps at 2 per company per 60 days ([FastApply comparison](https://blog.fastapply.co/auto-apply-jobs-tools-compared-2026)), Simplify Autopilot fails rather than guess ([help](https://help.simplify.jobs/articles/1784339-getting-started-with-autopilot)), and Scale.jobs gives screenshot proof ([Scale.jobs](https://scale.jobs/blog/best-job-application-services-comparison)). No product we found ships all of them together. This matters because the top complaints are about this exact gap: wrong answers (LazyApply), no submission log (JobHire), scams that can't be withdrawn (JobCopilot) and unreviewed applications (LoopCV).

5. **Free, key-less ATS discovery: 729 verified company boards on six public ATS APIs, plus 12+ free feeds.** HiringCafe (116k companies) and JobCopilot ("500k career pages") index more, but on their own servers. ApplyPilot runs the calls from the user's PC at zero marginal cost. A dedupe step prefers the copy whose apply link goes to an auto-apply-capable ATS. That auto-apply-aware routing is something we did not see elsewhere.

6. **Fair, non-renewing pricing at the low end of the market.** Free, then $12/mo, a **$29 Sprint Pass that never auto-renews**, or a $149 lifetime licence.
   - Comparable: RONIN ($49 one-time), Oaki ($50 one-time) and myjobb (UPI, no auto-renew).
   - Typical market: $24–$60/mo auto-renewing subscriptions with hidden pricing (Jobright, AIApply, Sonara, JobHire).

   This is a differentiator against most of the market, but not unique.

7. **India-aware answering inside a global tool.** The deterministic answerer handles CTC, expected CTC, notice period, per-skill years, Bengaluru ↔ Bangalore aliases and a 252-platform directory with Indian portals. myjobb and ApplyCove are India-only. Simplify, Jobright, JobCopilot and LoopCV ignore Indian fields ([myjobb comparison table](https://myjobb.ai/blog/best-tool-auto-apply-jobs-india)).

**Claims we should *not* make:**
- "Only local-first BYOK app": false (RONIN, career-ops, Apply Aide, ApplyEase, Applyocalypse).
- "Only tool with resume A/B testing": false (LoopCV).
- "Only tool with parallel campaigns": false (LoopCV loops, JobCopilot Elite's 3 copilots, LazyApply profiles).
- "Most job sources": false (HiringCafe, JobCopilot).

---

## 4. Features competitors have that ApplyPilot lacks (ranked by user value × feasibility)

**Scoring:** Value 1–5 (how often users cite it, how much it drives paying) × Feasibility 1–5 (fit with local Electron + Claude BYOK + zero-knowledge sync + PWA). **Where:** Desktop / Web (PWA + server) / Both. **Effort:** S ≤ 1 week · M 2–4 weeks · L > 1 month.

**PWA architecture assumption used throughout.** The server crawls only public job data (ATS APIs, feeds) and serves job listings. Anything personal (resume, profile, answers, applications) is encrypted on the device with a key derived from the user's passphrase and synced as opaque blobs. **Match scoring runs on the device:** the PWA downloads candidate jobs for coarse query buckets and scores them locally with the same `match.js` (bundled for the browser). The server never sees the resume or the match result.

| Rank | Feature | V | F | V×F | Where | Effort |
|---|---|---|---|---|---|---|
| 1 | Per-job tailored resume file (truth-locked) | 5 | 4 | 20 | Desktop (+ Web preview) | M |
| 2 | Mobile "Needs you" + approve queue (PWA) | 5 | 4 | 20 | Both | M |
| 3 | Swipe triage on mobile | 4 | 5 | 20 | Web | S |
| 4 | Email sync → automatic status updates | 5 | 3 | 15 | Desktop | M |
| 5 | Always-on discovery while the PC is off | 4 | 4 | 16 | Both | M |
| 6 | Companion browser extension (save + autofill anywhere) | 4 | 3 | 12 | Desktop | M |
| 7 | Visa-sponsorship filter and signal | 4 | 4 | 16 | Both | S–M |
| 8 | Referral finder from the user's own LinkedIn export | 4 | 4 | 16 | Both | S |
| 9 | Daily digest / morning report | 3 | 5 | 15 | Both | S |
| 10 | Learning from edits (cover-letter and answer style) | 3 | 5 | 15 | Desktop | S |
| 11 | Voice mock interview | 4 | 3 | 12 | Both | M |
| 12 | Salary insights | 3 | 4 | 12 | Both | M |
| 13 | Natural-language search | 3 | 4 | 12 | Both | S |
| 14 | Per-section confidence indicators before submit | 3 | 5 | 15 | Desktop | S |
| 15 | Better Workday (multi-page) assisted flow | 4 | 2 | 8 | Desktop | L |
| 16 | LinkedIn profile optimizer | 2 | 5 | 10 | Desktop | S |
| 17 | Hiring-manager contact discovery | 3 | 2 | 6 | Desktop | M |
| 18 | Public per-ATS completion stats | 2 | 4 | 8 | Both | S |
| — | Won't do: LinkedIn/Naukri bot submission, CAPTCHA solving, real-time interview "copilot", human VA service | | | | | |

### 4.1 Per-job tailored resume file, truth-locked (Desktop, M)
- **What:** for each application, generate a tailored PDF/DOCX that reorders and rephrases only real facts and upload *that* file instead of the base resume. Show a diff and keep each version.
- **Who has it:** Simplify+, Jobright, AIApply, FastApply (paid), myjobb (LaTeX PDF in 10–20 s), RONIN, career-ops, Oaki, Sorce, Resumly, JobCopilot (Elite only).
- **How users talk about it:** "The deciding factor is … whether the tool tailors each application or fires one stored resume at everything" ([Oaki](https://www.oaki.io/blog/best-auto-apply-tools-2026)). The flip side is that tailoring hallucinates: Jobright "fabricated a skill (Go)" ([Jobity](https://jobity.io/blog/jobright-review)), and Massive "AI-invented resume details" ([Jobara](https://jobara.ai/blog/use-massive-review)). ApplyIQ markets that it *never* rewrites your resume. Tailored applications are reported at ~5–15% callbacks vs 1–3% for bulk ([Resumly data summary](https://www.resumly.ai/answers/is-auto-apply-worth-it)).
- **Implementation:**
  - `resume.js` already parses into structured `workHistory`/`skills` via `ai.parseResume`. Persist that as a **facts vault** (`facts.json`): each bullet gets an ID and a source span in the original file.
  - Extend `ai.tailorResume` so its structured output returns `{ sections: [{ bulletId, text }] }`, may reference only existing `bulletId`s, and lists `newClaims[]`.
  - Add a deterministic verifier pass: any number, skill or employer not found in the facts vault blocks the build and shows in red.
  - Render locally with a small HTML template, then `webContents.printToPDF` in a hidden window. No new dependency; produces ATS-safe single-column PDFs. Use `docx` npm for a DOCX variant.
  - Cache per `(resumeId, jobId)`.
  - The engine's file-upload step takes the tailored path when `campaign.tailor = true`.
  - Cost: ~$0.03 per application on Sonnet 5.5. Free plan: 5 per day.
  - The PWA shows the diff read-only from the encrypted blob.

### 4.2 Mobile "Needs you" and approve queue (Both, M)
- **What:** on the phone, see matches waiting for review, approve or reject, answer a pending screening question, and pause campaigns. The desktop picks up the decisions and submits.
- **Who has it:** apps from Jobright (iOS/Android, alerts), Simplify (iOS + Safari Copilot), Sorce, Oaki, Massive (iOS). JobPilot sends "push notifications for items needing human input" ([GitHub](https://github.com/suxrobgm/jobpilot)).
- **How users talk about it:** Swipe apps grew on mobile convenience; Sorce reports 850K+ users and 1M+ applications ([Sorce](https://www.sorce.jobs/articles/sorce-pricing)). ApplyPilot's "awaiting-you" state stalls whenever the user is away from the PC.
- **Implementation:**
  - The desktop writes an E2E-encrypted "inbox" of `queued` and `awaiting-you` items (job summary, the question, options) to the sync store, encrypted with XChaCha20-Poly1305 under a key from the user's passphrase (Argon2id). The server stores only opaque blobs plus a per-device push token.
  - The PWA decrypts on the phone and writes back encrypted `decision` records: approve, reject, or answer with a value.
  - The desktop main process polls or long-polls the sync endpoint, decrypts, applies `campaigns.answerQuestion` / approve, then resumes the waiting tab, which `engine.js` already keeps open for 30 minutes.
  - Web Push carries no content, only a "you have 3 items" ping. The PWA fetches and decrypts.
  - Submission still happens only on the desktop, which keeps uniqueness claim #2.

### 4.3 Swipe triage (Web, S)
- **What:** card stack of ranked matches; right = queue for the desktop, left = skip (feeds learning), up = save.
- **Who has it:** Sorce, Wobo, FastApply Swipe.
- **How users talk about it:** Sorce's app is "genuinely well designed, with an intuitive swipe mechanic", but reviews are mixed on match quality ([Ace review](https://aceapp.ai/blog/sorce-review)). Our explainable score on each card answers the match-quality complaint.
- **Implementation:**
  - A PWA view over the same decrypted queue, with gesture handling (pointer events, no library).
  - Swipe-left reasons ("too senior", "wrong location") become campaign exclude keywords after confirmation.
  - Decisions sync back as encrypted records (same channel as 4.2).

### 4.4 Email sync → automatic status updates (Desktop, M)
- **What:** detect interview invites, rejections, assessments and "application received" emails, match them to applications, and suggest status changes (one-click accept-all).
- **Who has it:** Simplify (Gmail only, suggestions plus accept-all) ([help](https://help.simplify.jobs/articles/0236686-email-integration)), Resumly (auto-advance), JobPilot (Gmail). LoopCV tracks opens and replies on its own outreach emails.
- **How users talk about it:** Updating trackers by hand is the top reason trackers go stale. Without outcome data, our A/B analytics and per-resume interview rate are starved.
- **Implementation:**
  - Local only. Read via **IMAP with an app password**, or Microsoft Graph for Outlook (device-code OAuth, public-client app). Gmail's API read scope is "restricted" and needs a paid security assessment (MARKET_RESEARCH §3.2), so offer Gmail via IMAP + app password first.
  - Fetch only headers and snippets from the last N days and match by company domain or ATS sender (`no-reply@greenhouse.io`, `@hire.lever.co`, `ashbyhq.com`).
  - Classify with a local regex pass first, then Claude Haiku 4.5 only for ambiguous mails (≈ $0.001 each).
  - Store the classification, not the email body.
  - Feeds §5's outcome-calibrated scoring.

### 4.5 Always-on discovery while the PC is off (Both, M)
- **What:** saved searches keep running in the cloud. When the desktop wakes, it finds pre-scored matches ready to apply.
- **Who has it:** LoopCV, JobCopilot, ApplyCove, myjobb, FastApply Stealth, Simplify Autopilot.
- **How users talk about it:** LoopCV's "operates with computer off" is a selling point ([FastApply comparison](https://blog.fastapply.co/auto-apply-jobs-tools-compared-2026)). The PC-must-be-on requirement is our clearest functional disadvantage.
- **Implementation:**
  - The server already crawls public ATS/feed data for the PWA. Expose `GET /jobs?bucket=<role-bucket>&loc=<region>&since=<ts>`, where buckets are coarse role families so the server learns little.
  - The **phone PWA** (or the desktop on wake) downloads the deltas and scores them locally.
  - On wake, the desktop runs `runOnce()` against the server index **in addition to** its own connectors, which cuts cold search time (~25–35 s today).
  - **Never submit from the server.** That would break uniqueness claims #2 and #3.

### 4.6 Companion browser extension (Desktop, M)
- **What:** (a) "Save to ApplyPilot" on any job page (LinkedIn, Naukri, company sites); (b) autofill from the ApplyPilot profile and answer bank in the user's *everyday* browser.
- **Who has it:** Simplify, Teal (saves from 50+ boards), Huntr, JobWizard, Careerflow, Jobright, LazyApply.
- **How users talk about it:** Teal's extension is rated 4.9★ and is "category-leading" ([Resumly on Teal](https://www.resumly.ai/answers/teal-review)). JobWizard is popular "particularly for Workday".
- **Implementation:**
  - A Manifest V3 extension talks to the desktop over **Chrome Native Messaging** (host manifest registered by the NSIS installer under HKCU). No network and no server.
  - Saving posts the URL plus page JSON-LD (`JobPosting` schema) to `jobs`.
  - Autofill reuses `answers.js` and `dom.js` logic, ported to a content script that asks the native host for values per label.
  - Assisted only: it never clicks submit, which stays within LinkedIn and Naukri ToS. On mobile, use the PWA **Web Share Target** to share a job link into the encrypted "saved" list.

### 4.7 Visa-sponsorship filter and signal (Both, S–M)
- **What:** a "sponsors visas" badge and filter backed by public data: US DOL H-1B LCA disclosures, the UK Home Office Register of Licensed Sponsors, and Netherlands IND recognised sponsors.
- **Who has it:** Jobright (H-1B filter), Massive (visa filter), career-ops (sponsorship flags).
- **How users talk about it:** It is a core need for India → US/UK/EU seekers, one of our primary audiences.
- **Implementation:**
  - The server builds a `company → {h1bFilings, lastYear, ukSponsor}` table from public files quarterly and serves it as a small static JSON for the desktop and PWA.
  - Match on normalised company name plus domain.
  - Add the score flag and filter in `match.js`.
  - The ~1–3 MB payload can also ship offline with app updates.

### 4.8 Referral finder from the user's own LinkedIn export (Both, S)
- **What:** import `Connections.csv` (from LinkedIn's "Get a copy of your data"). For every match, show "You know 2 people at Razorpay", then draft a referral ask (we already have `ai.outreach({kind:'referral'})`).
- **Who has it:** Jobright Insider Connections, Simplify Network Copilot and Referrals, LazyApply referral emails (auto-sent, which we won't do).
- **How users talk about it:** Referral-first advice dominates r/cscareerquestions and r/developersIndia. Jobright reviewers call Insider Connections a strength ([Jobity](https://jobity.io/blog/jobright-review)).
- **Implementation:**
  - Parse the CSV locally and fuzzy-match `Company` to job companies.
  - Store it in an encrypted collection that syncs to the PWA.
  - No scraping and no LinkedIn API. The user sends any message themselves.

### 4.9 Daily digest / morning report (Both, S)
- **What:** at 9 AM: new matches, waiting approvals, follow-ups due, interviews this week, yesterday's submissions with proof.
- **Who has it:** myjobb (9 AM report with one-click retry), Scale.jobs (WhatsApp updates), Jobright (alerts).
- **Implementation:** a desktop toast plus a PWA Web Push ping. The content is decrypted on the device. An optional email digest would need content on the server, so keep it opt-in and generic ("You have 12 new matches").

### 4.10 Learning from edits (Desktop, S)
- **What:** when the user edits an AI answer or cover letter, store the edit as a style example and few-shot it into future prompts.
- **Who has it:** JobCopilot ("learns how you respond and improves over time" ([jobcopilot.com](https://jobcopilot.com/))) and ApplyCove (remembers edited answers).
- **Implementation:** the answer bank already stores answers. Add `styleExamples` (last 5 user-edited letters and answers) to the system prompt and use prompt caching to keep cost flat.

### 4.11 Voice mock interview (Both, M)
- **What:** spoken practice for a specific job, with per-answer feedback (STAR structure, filler words, specificity).
- **Who has it:** AIApply, JobCopilot, LoopCV, Careerflow Premium Plus, Indeed Career Scout, Final Round (free mock tier).
- **Implementation:**
  - Use the browser Web Speech API (Electron renderer and PWA) for speech-to-text and text-to-speech, so no audio leaves the device except the transcript sent to Claude via BYOK.
  - Reuse `ai.interviewPrep` questions and score each transcript with structured output.
  - The PWA version suits commuting.

### 4.12 Salary insights (Both, M)
- **What:** salary band per role and location from postings that disclose pay, plus "this offer is in the Nth percentile".
- **Who has it:** Indeed Career Scout (salary insights), career-ops (comp research), LoopCV (shows salary).
- **Implementation:**
  - The server aggregates `salaryMin`/`salaryMax` from public postings: US pay-transparency states, Adzuna, Reed, RemoteOK, Himalayas.
  - Publish percentile tables per `(role family, country/metro, seniority)` as static JSON.
  - The device does the comparison. INR CTC needs separate handling, because Indian postings rarely disclose pay.

### 4.13 Natural-language search (Both, S)
- **What:** a search box that accepts a sentence like "remote data roles in fintech, no people management, ₹30L+" and converts it to campaign filters.
- **Who has it:** LinkedIn AI search (classic search is being retired from Sep 2026), Jobright Orion, career-ops (chat).
- **Implementation:** one Claude Haiku call via BYOK with structured output → `{roles, locations, remote, minSalary, include/exclude keywords}`. Without a key, fall back to a rule parser. The PWA sends only the resulting coarse bucket to the server.

### 4.14 Per-section confidence indicators (Desktop, S)
- **What:** before submit, show each field group (contact, work auth, salary, free-text answers) with high, medium or low confidence and its source (profile, answer bank, AI, user).
- **Who has it:** LinkedIn Premium Apply Assistant ([Social Media Today](https://www.socialmediatoday.com/news/linkedin-automates-job-application-process-for-premium-users/823719/)).
- **Implementation:** `answers.js` already knows the source of each value. Emit `{field, value, source, confidence}` from adapters and render it in the "Needs you" drawer and the phone approve card.

### 4.15 Better Workday flow (Desktop, L)
- **What:** guided multi-page Workday applications in assisted mode, with account creation done by the user.
- **Who has it:** Simplify and JobWizard (autofill), Massive+ (claimed), FastApply (44.5% completion).
- **Implementation:** a dedicated `workday` adapter with page detection (`data-automation-id` attributes), filling one step at a time and waiting for the user's "Next". It never creates accounts or handles passwords. This is high value in the US but expensive, because Workday tenants vary.

### 4.16 LinkedIn profile optimizer (Desktop, S)
- **Who has it:** Careerflow, Teal, Jobscan.
- **Implementation:** the user uploads the LinkedIn "Save to PDF" export. Claude critiques the headline, about section and experience against target campaigns. No LinkedIn automation.

### 4.17 Hiring-manager contact discovery (Desktop, M)
- **Who has it:** JobCopilot (email credits), LoopCV and myjobb (send cold emails), LazyApply.
- **Implementation:** BYOK for an email-finder API (Hunter or Apollo key in Settings, stored with DPAPI). Draft only, and the user sends from their own client via a `mailto:` link. Value is moderate, and auto-sending cold email is a spam risk, so we won't send.

### 4.18 Public per-ATS completion stats (Both, S)
- **Who has it:** FastApply publishes completion rates by platform ([FastApply](https://blog.fastapply.co/ai-auto-apply-for-jobs-how-it-works-2026)).
- **Implementation:** show local stats now (per ATS: filled, submitted, handed to user). Later, publish an opt-in, aggregate-only count (no PII) as a trust page.

### Deliberately not building
- **Bot submission on LinkedIn, Indeed or Naukri, or server-side session-cookie replay** (LazyApply, LoopCV, FastApply, myjobb, ApplyCove). This conflicts with their terms and with our core trust claim.
- **CAPTCHA solving** (RONIN).
- **"Undetectable" claims** (Massive).
- **A real-time interview whisper copilot** (Final Round, AIApply Interview Buddy). This is ethically grey and detectable.
- **A human assistant service** (Scale.jobs). This is not software.

---

## 5. Features nobody has that would make ApplyPilot clearly best

Each idea is grounded in a documented complaint and fits the local + E2E + PWA architecture.

1. **Phone as an end-to-end-encrypted remote control for the desktop agent.** (Both, M)
   - Approve, answer, pause or kill campaigns from the phone. The phone never submits anything and the server never reads anything.
   - **Grounding:** cloud tools offer convenience but hold your resume and sometimes your session cookies (myjobb). Local tools (RONIN, career-ops) have no mobile surface. Nobody does both.
   - This is §4.2 positioned as the headline: "the convenience of a cloud autopilot, the privacy of a desktop app".

2. **Undo window before submit, plus withdraw assistance.** (Desktop, S)
   - Every auto-submit waits a configurable 2–15 minutes in a "sending" state, visible on desktop and phone, Gmail-style.
   - After submission, offer a pre-drafted withdrawal email to the ATS contact.
   - **Grounding:** JobCopilot users report scam postings, and "once an application is sent, it cannot be withdrawn — your resume, email, and phone reach whoever posted the listing" ([Resumly](https://www.resumly.ai/answers/jobcopilot-review)). LoopCV's Trustpilot complaints cite unreviewed applications ([FastApply](https://blog.fastapply.co/is-loopcv-legit-2026-review)).
   - **Implementation:** `applyApplication` fills the form, holds the tab at the submit step for N minutes (the engine already holds tabs), then submits unless the user cancels.

3. **Pre-flight scam check before any PII leaves the machine.** (Both, S)
   - Block auto-submit, and warn in assisted mode, when:
     - the apply domain doesn't match the company domain or a known ATS;
     - the domain is a lookalike or newly registered (a server-side WHOIS-age lookup that receives only the domain);
     - the contact uses free email;
     - the posting asks for SSN, Aadhaar, PAN, bank details or fees;
     - or it matches FTC red flags.
   - **Grounding:** 5 of 40 JobCopilot applications went to scams (Reddit, via [Resumly](https://www.resumly.ai/answers/jobcopilot-review)). The FTC reports $150.4M in job-scam losses from 25,002 reports in Q4 2025 alone ([CW33/FTC](https://cw33.com/news/local/job-scams-result-in-150-4-million-losses-ftc-reports/), [FTC](https://consumer.ftc.gov/all-scams/job-scams)). 69% of seekers have met fraudulent postings ([HR Tech Edge](https://www.hrtechedge.com/hr/greenhouses-real-talent-targets-ai-era-hiring-fraud/)).

4. **Ghost-job timeline from the public index.** (Both, M)
   - The server already crawls public ATS boards for the PWA. Keeping history (first seen, last seen, reposts, req-ID churn) lets every card say "open 94 days · reposted 3× · company closed 0 roles this quarter".
   - Just before submitting, re-check that the posting is still live via the ATS API.
   - **Grounding:**
     - Estimates put ghost jobs at 1 in 7 to 1 in 3 postings; Greenhouse estimates 18–22% per quarter ([JobIntel](https://www.jobintel.com/blog/ghost-job-statistics-2026)).
     - JobCopilot users cite ghost jobs ([JobHire review](https://jobhire.ai/blog/jobcopilot-review)).
     - HiringCafe's main praise is that jobs "disappear when companies take them down" ([Dreamwork](https://www.dreamworkhq.com/blog/hiring-cafe-review)).
     - career-ops detects reposts but has no history. Nobody shows a timeline.

5. **Company hiring-velocity signal.** (Both, S once #4 exists)
   - From the same history: roles opened and closed per company per month, and median time-to-close.
   - Rank "companies that actually hire for your role" and suggest apply-by dates ("this team's roles close in ~19 days").
   - Public data only, computed on the server, consumed on the device.

6. **Claim provenance and a "zero invented claims" badge.** (Desktop, S, on top of §4.1)
   - Every sentence in a tailored resume, cover letter or screening answer links back to a fact-vault entry. Hovering shows the source.
   - The submit packet shows "0 unsupported claims", or blocks.
   - **Grounding:** Jobright fabricated a skill ([Jobity](https://jobity.io/blog/jobright-review)). Massive invented resume details ([Jobara](https://jobara.ai/blog/use-massive-review)). LinkedIn warns that "generated claims are not automatically true" ([Jobsistant](https://www.jobsistant.com/guides/linkedin-2026-ai-changes)). No tool makes provenance visible.

7. **Outcome-calibrated personal match model and "cost per interview".** (Desktop, M)
   - Use outcomes (from §4.4 email sync and manual moves) to fit a small local logistic model over the existing score features (title, skills, experience, location, freshness, source, ATS, resume).
   - Auto-suggest each campaign's `minScore`. Report "$/interview": BYOK spend plus plan cost, divided by interviews.
   - **Grounding:** no vendor publishes verified interview outcome data ([FastApply comparison](https://blog.fastapply.co/auto-apply-jobs-tools-compared-2026)). LoopCV A/B tests resumes but doesn't learn the match threshold.

8. **Eligibility hard-filters that read the posting.** (Both, S)
   - Detect the JD language, remote-region restrictions ("US only", "EU timezone"), work-authorisation requirements, clearance needs and required degrees. Treat mismatches as hard excludes, not score penalties.
   - **Grounding:**
     - AIApply applied to jobs "in languages I don't speak" ([Resumly](https://www.resumly.ai/answers/aiapply-review)).
     - JobCopilot recommended "weird US based jobs" for a remote seeker ([Resumly](https://www.resumly.ai/answers/jobcopilot-review)).
     - A JobHire audit found a master's holder sent to fast-food roles (MARKET_RESEARCH [26]).
   - **Implementation:** cheap regex plus a franc-style language detector in `match.js`, with a Haiku fallback.

9. **One-click unemployment work-search log.** (Desktop, S)
   - Export a state-formatted weekly log (date, employer, contact method, position, result) with proof screenshots attached.
   - **Grounding:** most US states require weekly logs. For example, NY requires 3 activities per week, TX 6 and FL 5 ([NY DOL](https://dol.ny.gov/services/ui/wsr), [NELP](https://www.nelp.org/insights-research/work-search-requirements/)). Our proof vault already holds the data. We found no auto-applier offering this.

10. **E2E-shared read-only pipeline for a mentor, coach or placement cell.** (Both, S–M)
    - Share a link that opens a decrypted read-only view of the tracker and analytics (key in the URL fragment, never sent to the server), revocable at any time.
    - **Grounding:** placement cells and coaches are a stated go-to-market channel (MARKET_RESEARCH §5.2). Coaching is a whole category (Wonsulting, LoopCV Done-For-You at €87.99/mo with weekly calls). No tool shares a pipeline privately.

11. **Import from competitors.** (Desktop, S)
    - Import tracker CSVs from Teal, Huntr and Simplify, plus LoopCV and JobCopilot exports where available, so switching costs nothing.
    - **Grounding:** billing traps keep users stuck (Jobright 72% of 1-stars on billing; Teal charges after cancel; see MARKET_RESEARCH §2).

12. **A "recruiter-safe" pacing meter.** (Desktop, S)
    - A visible per-company and per-ATS rate indicator: applications sent to this company in 30 days, to this ATS today, and how far you are from any cap.
    - **Grounding:** Greenhouse Real Talent flags 1 in 4 candidates, and Reddit and Blind users fear blacklisting from over-applying (MARKET_RESEARCH [42]). The guards exist in `campaigns.js`, but they aren't visible as a trust feature.

---

## 6. Top 15 to build now

Order balances user value, effort, and reinforcement of the privacy and safety positioning. "PWA" items assume the sync and encryption layer lands first (item 2).

| # | Build | Where | Effort | Why now |
|---|---|---|---|---|
| 1 | **Per-job tailored resume PDF/DOCX with fact vault, diff and claim provenance** (§4.1 + §5.6) | Desktop | M | Biggest gap vs. every paid competitor; fixes their #1 AI complaint (fabrication) |
| 2 | **PWA "Needs you" and approve queue over E2E-encrypted sync + content-free push** (§4.2 + §5.1) | Both | M | Removes the "must sit at the PC" limit; the headline differentiator |
| 3 | **Swipe triage in the PWA** (§4.3) | Web | S | Cheap once #2 exists; proven engagement pattern (Sorce, Wobo, FastApply) |
| 4 | **Undo-before-submit window** (§5.2) | Desktop | S | Novel trust feature; answers "can't withdraw" complaints |
| 5 | **Pre-flight scam check before PII leaves** (§5.3) | Both | S | Novel; FTC-documented harm; protects the auto-submit promise |
| 6 | **Eligibility hard-filters** (language, remote region, work authorisation) (§5.8) | Both | S | Cheap; kills the most visible "irrelevant application" failures |
| 7 | **Email sync via IMAP/Outlook → suggested status updates** (§4.4) | Desktop | M | Feeds analytics and A/B; Simplify has it, we don't |
| 8 | **Always-on server discovery with on-device scoring** (§4.5) | Both | M | Matches cloud tools' "works while you sleep" without server-side applying |
| 9 | **Ghost-job timeline + liveness re-check before submit** (§5.4) | Both | M | Novel; uses the server's public crawl history; big trust signal |
| 10 | **Visa-sponsorship badge and filter** (H-1B LCA, UK sponsor register) (§4.7) | Both | S | Core need for India → abroad seekers; public data |
| 11 | **Referral finder from LinkedIn Connections.csv** (§4.8) | Both | S | Jobright/Simplify-class feature with zero scraping |
| 12 | **Morning digest** (desktop toast + PWA push) (§4.9) | Both | S | Retention; myjobb's 9 AM report shows demand |
| 13 | **Per-field confidence + source panel in "Needs you"** (§4.14) | Desktop | S | Matches LinkedIn Apply Assistant; data already exists in `answers.js` |
| 14 | **Companion extension via Native Messaging** (save any job + assisted autofill) (§4.6) | Desktop | M | Covers LinkedIn, Naukri and Workday in the user's own browser, ToS-safe |
| 15 | **Unemployment work-search log export** (§5.9) + **competitor tracker import** (§5.11) | Desktop | S | Cheap, novel and switch-enabling; uses the existing proof vault |

**Next after these:** voice mock interview (M), salary percentiles (M), natural-language search (S), outcome-calibrated min-score and cost per interview (M), mentor share links (S–M), Workday multi-page adapter (L).

---

## 7. Sources

Primary vendor pages and help centers:
- Simplify: [Autopilot](https://help.simplify.jobs/articles/1784339-getting-started-with-autopilot) · [Email integration](https://help.simplify.jobs/articles/0236686-email-integration) · [Help center](https://help.simplify.jobs/) · [Copilot](https://simplify.jobs/copilot)
- Jobright: [jobright.ai](https://jobright.ai/) · [App Store](https://apps.apple.com/us/app/jobright-ai-job-search/id6738236788) · [Google Play](https://play.google.com/store/apps/details?id=ai.jobright.orion&hl=en)
- JobCopilot: [jobcopilot.com](https://jobcopilot.com/) · [pricing](https://jobcopilot.com/pricing/)
- [LazyApply](https://lazyapply.com/) · [LoopCV auto-apply](https://www.loopcv.pro/autoapply/) · [AIApply auto-apply](https://aiapply.co/auto-apply) · [UseMassive](https://usemassive.com/)
- FastApply: [four modes](https://fastapply.co/ai-auto-apply) · [how it works and completion rates](https://blog.fastapply.co/ai-auto-apply-for-jobs-how-it-works-2026)
- myjobb: [auto-apply](https://myjobb.ai/features/auto-apply) · [India comparison](https://myjobb.ai/blog/best-tool-auto-apply-jobs-india)
- [ApplyCove](https://applycove.com/) · [AgentCo Scout](https://agentco.in/blog/best-ai-job-search-tools-india-2026) · [RONIN](https://roninapply.com/)
- [career-ops](https://github.com/santifer/career-ops) · [JobPilot](https://github.com/suxrobgm/jobpilot) · [Applyocalypse](https://github.com/varunk47/Applyocalypse) · [ApplyEase](https://github.com/REDmuff1n/applyease) · [Apply Aide privacy](https://applyaide.com/privacy)
- [Jobscan Auto Apply](https://www.jobscan.co/auto-apply) · [Huntr pricing](https://huntr.co/pricing) · [Sorce pricing](https://www.sorce.jobs/articles/sorce-pricing) · [Oaki (App Store)](https://apps.apple.com/us/app/oaki/id6751103290) · [Adzuna ApplyIQ](https://www.adzuna.com/apply-iq) · [JobWizard](https://jobwizard.ai/) · [Wonsulting JobTrackerAI](https://www.wonsulting.com/jobtrackerai) · [AutoApplier (Chrome Web Store)](https://chromewebstore.google.com/detail/linkedin-autoapplier/niphbnpodnkchmifkcpoohlakeofljam)
- Indeed: [Career Scout](https://www.indeed.com/career-advice/finding-a-job/what-is-indeed-career-scout)
- Greenhouse: [Real Talent](https://www.greenhouse.com/product-features/greenhouse-real-talent)

Platform news and context:
- LinkedIn Premium Apply Assistant: [Social Media Today, 24 Jun 2026](https://www.socialmediatoday.com/news/linkedin-automates-job-application-process-for-premium-users/823719/)
- LinkedIn 2026 AI search and Job Match: [Jobsistant](https://www.jobsistant.com/guides/linkedin-2026-ai-changes)
- ChatGPT Jobs status: [Careerflow, 14 Sep 2026](https://www.careerflow.ai/blog/chatgpt-jobs-feature)
- Naukri Pro AI Resume Maker: [Business Standard](https://www.business-standard.com/content/press-releases-ani/naukri-launches-ai-powered-resume-maker-to-help-job-seekers-build-professional-recruiter-ready-cvs-effortlessly-125112100431_1.html)
- Greenhouse Real Talent stats: [HR Tech Edge, 24 Sep 2026](https://www.hrtechedge.com/hr/greenhouses-real-talent-targets-ai-era-hiring-fraud/)
- Ghost jobs: [JobIntel](https://www.jobintel.com/blog/ghost-job-statistics-2026)
- Job scams: [FTC](https://consumer.ftc.gov/all-scams/job-scams) · [CW33 on FTC Q4 2025 data](https://cw33.com/news/local/job-scams-result-in-150-4-million-losses-ftc-reports/)
- Work-search requirements: [NY DOL](https://dol.ny.gov/services/ui/wsr) · [NELP](https://www.nelp.org/insights-research/work-search-requirements/)
- Platform terms: [LinkedIn prohibited software](https://www.linkedin.com/help/linkedin/answer/a1341387) · [Indeed ToS](https://www.indeed.com/legal) · [Naukri T&C](https://www.naukri.com/termsconditions)

Third-party reviews and comparisons. Many are written by competitors; treat them as indicative.
- Roundups: [Oaki best auto-apply 2026](https://www.oaki.io/blog/best-auto-apply-tools-2026) · [FastApply tools compared (Apr 2026)](https://blog.fastapply.co/auto-apply-jobs-tools-compared-2026) · [Valasys top 10](https://valasys.com/top-10-ai-tools-for-automated-job-applications-tested-and-ranked/) · [Resumly best AI auto-apply](https://www.resumly.ai/best/best-ai-auto-apply-tools) · [Resumly: is auto-apply worth it](https://www.resumly.ai/answers/is-auto-apply-worth-it) · [LoopCV directory](https://www.loopcv.pro/directory/)
- Jobright: [Jobity (Sep 2026)](https://jobity.io/blog/jobright-review) · [Wobo](https://www.wobo.ai/blog/jobright-review/)
- JobCopilot: [Resumly](https://www.resumly.ai/answers/jobcopilot-review) · [JobHire](https://jobhire.ai/blog/jobcopilot-review)
- AIApply: [Resumly](https://www.resumly.ai/answers/aiapply-review) · [Scoutify](https://scoutify.com/blog/aiapply-review/)
- LoopCV: [FastApply](https://blog.fastapply.co/is-loopcv-legit-2026-review)
- Massive: [Jobara](https://jobara.ai/blog/use-massive-review) · [LoopCV directory](https://www.loopcv.pro/directory/massive/)
- Sonara: [Dreamwork](https://www.dreamworkhq.com/blog/sonara-ai-review) · [Jobloo](https://jobloo.co/blog/sonara-ai-review-2026/)
- JobHire: [Dreamwork](https://www.dreamworkhq.com/blog/jobhire-ai-review) · [LoopCV blog](https://blog.loopcv.pro/jobhire-review/)
- Sorce: [Ace](https://aceapp.ai/blog/sorce-review)
- Wobo: [JobHire](https://jobhire.ai/blog/wobo-ai-review) · [Toolworthy](https://www.toolworthy.ai/tool/wobo)
- Teal: [Resumly](https://www.resumly.ai/answers/teal-review) · [LoopCV blog](https://blog.loopcv.pro/teal-hq-review/)
- Careerflow: [Remote Job Assistant](https://www.remotejobassistant.com/blog/careerflow-review)
- Final Round AI: [InterviewMan](https://interviewman.com/compare/final-round-ai) · [LoopCV directory](https://www.loopcv.pro/directory/finalround/)
- HiringCafe: [Dreamwork](https://www.dreamworkhq.com/blog/hiring-cafe-review) · [ResumeUp](https://resumeup.ai/blog/hiringcafe-review)
- EarnBetter: [Dreamwork](https://www.dreamworkhq.com/blog/earnbetter-review)
- Jobsolv: [LoopCV directory](https://www.loopcv.pro/directory/jobsolv/)
- Swooped: [LoopCV directory](https://www.loopcv.pro/directory/swooped/)
- Scale.jobs: [Scale.jobs comparison](https://scale.jobs/blog/best-job-application-services-comparison)
- Jobscan: [Jobscan vs JobCopilot](https://www.jobscan.co/blog/jobscan-vs-jobcopilot/)
