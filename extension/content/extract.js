// ApplyPilot job extractor (content script, injected on demand with activeTab).
// Order: schema.org JobPosting JSON-LD -> site-specific selectors (LinkedIn, Indeed, Naukri, Glassdoor,
// Wellfound, foundit, Instahyre) -> generic heuristics. Each field takes the first non-empty value.
// Read-only: never clicks, never modifies the page.
/* eslint-disable no-undef */
(function () {
  'use strict';

  const clean = (t) => String(t == null ? '' : t).replace(/ /g, ' ').replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const oneLine = (t) => clean(t).replace(/\s*\n\s*/g, ' · ').replace(/\s+/g, ' ').trim();
  const abs = (u) => { try { const x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };

  function htmlToText(html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(`<div>${String(html)}</div>`, 'text/html');
    // Entity-encoded HTML ("&lt;p&gt;") is common in JSON-LD: decode once more if needed.
    let root = doc.body;
    if (!root.querySelector('*') && /<[a-z][^>]*>/i.test(root.textContent || '')) root = new DOMParser().parseFromString(`<div>${root.textContent}</div>`, 'text/html').body;
    return nodeText(root);
  }
  // Text with paragraph / list structure preserved.
  function nodeText(el) {
    if (!el) return '';
    const c = el.cloneNode(true);
    c.querySelectorAll('script,style,noscript,svg,button,iframe,template').forEach((n) => n.remove());
    c.querySelectorAll('li').forEach((li) => li.insertBefore(document.createTextNode('• '), li.firstChild));
    c.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
    c.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,tr,section,ul,ol').forEach((b) => { b.appendChild(document.createTextNode('\n')); });
    return clean(c.textContent || '');
  }
  const visible = (el) => { if (!el || !el.getBoundingClientRect) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const q = (sels, root = document) => {
    for (const s of [].concat(sels)) {
      let els = [];
      try { els = [...root.querySelectorAll(s)]; } catch { continue; }
      const el = els.find(visible) || els[0];
      if (el && clean(el.innerText || el.textContent)) return el;
    }
    return null;
  };
  const qText = (sels, root) => { const el = q(sels, root); return el ? oneLine(el.innerText || el.textContent) : ''; };
  const qBlock = (sels, root) => { const el = q(sels, root); return el ? nodeText(el) : ''; };
  const meta = (name) => { const el = document.querySelector(`meta[property="${name}"],meta[name="${name}"]`); return el ? clean(el.getAttribute('content')) : ''; };

  // ------------------------------------------------------------------ 1. JSON-LD
  function jsonLdPostings() {
    const out = [];
    const visit = (n, depth = 0) => {
      if (!n || depth > 6) return;
      if (Array.isArray(n)) { n.forEach((x) => visit(x, depth + 1)); return; }
      if (typeof n !== 'object') return;
      const t = [].concat(n['@type'] || []).map(String);
      if (t.some((x) => /(^|\/)JobPosting$/i.test(x))) out.push(n);
      if (n['@graph']) visit(n['@graph'], depth + 1);
      if (n.mainEntity) visit(n.mainEntity, depth + 1);
    };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      const txt = (s.textContent || '').trim();
      if (!txt) continue;
      try { visit(JSON.parse(txt)); } catch {
        // Some sites ship JSON-LD with raw newlines inside strings.
        try { visit(JSON.parse(txt.replace(/[\u0000-\u001f]+/g, ' '))); } catch { /* ignore */ }
      }
    }
    return out;
  }
  const nameOf = (v) => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? nameOf(v[0]) : v.name || v['@value'] || '');
  function placeText(p) {
    if (!p) return '';
    if (typeof p === 'string') return p;
    if (Array.isArray(p)) return [...new Set(p.map(placeText).filter(Boolean))].slice(0, 4).join(' / ');
    const a = p.address || p;
    if (typeof a === 'string') return a;
    const country = nameOf(a.addressCountry);
    return [a.addressLocality, a.addressRegion, country].map((x) => clean(nameOf(x))).filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ') || clean(p.name || '');
  }
  function salaryOf(bs) {
    if (!bs) return {};
    const b = Array.isArray(bs) ? bs[0] : bs;
    if (typeof b !== 'object') return { salaryText: String(b) };
    const v = b.value && typeof b.value === 'object' ? b.value : { value: b.value };
    const min = Number(v.minValue ?? v.value); const max = Number(v.maxValue ?? v.value);
    const unit = String(v.unitText || b.unitText || '').toLowerCase();
    const cur = b.currency || v.currency || '';
    const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '');
    return {
      salaryMin: Number.isFinite(min) ? min : null,
      salaryMax: Number.isFinite(max) ? max : null,
      salaryCurrency: cur || null,
      salaryText: Number.isFinite(min) ? `${cur ? `${cur} ` : ''}${fmt(min)}${Number.isFinite(max) && max !== min ? ` – ${fmt(max)}` : ''}${unit ? ` / ${unit.replace(/^per\s+/, '')}` : ''}` : null,
    };
  }
  function fromJsonLd() {
    const list = jsonLdPostings();
    if (!list.length) return null;
    // Prefer the posting whose title appears in the page heading (job search pages may list several).
    const h1 = oneLine((document.querySelector('h1') || {}).innerText || '').toLowerCase();
    const j = list.find((x) => h1 && nameOf(x.title).toLowerCase() && h1.includes(String(nameOf(x.title)).toLowerCase().slice(0, 30))) || list[0];
    const remote = /TELECOMMUTE/i.test(JSON.stringify(j.jobLocationType || '')) || /remote/i.test(nameOf(j.title));
    let location = placeText(j.jobLocation);
    if (!location && j.applicantLocationRequirements) location = `Remote (${placeText(j.applicantLocationRequirements)})`;
    if (remote && location && !/remote/i.test(location)) location = `${location} (Remote)`;
    if (!location && remote) location = 'Remote';
    const org = j.hiringOrganization || {};
    const ident = j.identifier && (j.identifier.value || (typeof j.identifier === 'string' ? j.identifier : ''));
    return {
      title: oneLine(htmlToText(nameOf(j.title))),
      company: oneLine(nameOf(org)),
      companyLogo: abs(typeof org.logo === 'string' ? org.logo : (org.logo && org.logo.url) || ''),
      location: oneLine(location),
      remote,
      description: htmlToText(j.description || ''),
      employmentType: [].concat(j.employmentType || []).join(', '),
      postedAt: j.datePosted || null,
      validThrough: j.validThrough || null,
      url: abs(j.url || '') || '',
      externalId: ident ? String(ident) : '',
      ...salaryOf(j.baseSalary || j.estimatedSalary),
    };
  }

  // ------------------------------------------------------------------ 2. site-specific
  const SITES = [
    {
      id: 'linkedin', host: /(^|\.)linkedin\.com$/,
      title: ['.job-details-jobs-unified-top-card__job-title h1', '.job-details-jobs-unified-top-card__job-title', '.jobs-unified-top-card__job-title', '.top-card-layout__title', 'h1.topcard__title', '.jobs-details h1', 'main h1'],
      company: ['.job-details-jobs-unified-top-card__company-name a', '.job-details-jobs-unified-top-card__company-name', '.jobs-unified-top-card__company-name a', '.topcard__org-name-link', '.topcard__flavor a', '.top-card-layout__second-subline a'],
      location: ['.job-details-jobs-unified-top-card__primary-description-container .tvm__text:first-child', '.job-details-jobs-unified-top-card__bullet', '.jobs-unified-top-card__bullet', '.topcard__flavor--bullet', '.top-card-layout__second-subline .topcard__flavor:nth-of-type(2)'],
      description: ['#job-details', '.jobs-description__content', '.jobs-description-content__text', '.show-more-less-html__markup', '.description__text'],
      salary: ['.job-details-jobs-unified-top-card__job-insight--highlight', '.salary.compensation__salary', '.compensation__salary'],
      externalId: () => (location.href.match(/currentJobId=(\d+)/) || location.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/) || [])[1],
      canonical: (id) => (id ? `https://www.linkedin.com/jobs/view/${id}/` : ''),
    },
    {
      id: 'indeed', host: /(^|\.)indeed\.[a-z.]+$/,
      title: ['[data-testid="jobsearch-JobInfoHeader-title"]', 'h1.jobsearch-JobInfoHeader-title', '.jobsearch-JobInfoHeader-title', 'h2.jobsearch-JobInfoHeader-title'],
      company: ['[data-testid="inlineHeader-companyName"]', '[data-company-name="true"]', '.jobsearch-CompanyInfoContainer a', '.jobsearch-InlineCompanyRating div:first-child'],
      location: ['[data-testid="inlineHeader-companyLocation"]', '[data-testid="job-location"]', '[data-testid="jobsearch-JobInfoHeader-companyLocation"]', '.jobsearch-JobInfoHeader-subtitle > div:last-child'],
      description: ['#jobDescriptionText', '.jobsearch-jobDescriptionText'],
      salary: ['#salaryInfoAndJobType', '[data-testid="jobsearch-OtherJobDetailsContainer"] [aria-label*="Pay" i]'],
      externalId: () => new URL(location.href).searchParams.get('jk') || new URL(location.href).searchParams.get('vjk'),
      canonical: (id) => (id ? `${location.origin}/viewjob?jk=${id}` : ''),
    },
    {
      id: 'naukri', host: /(^|\.)naukri\.com$/,
      title: ['[class*="jd-header-title"]', 'h1.jd-header-title', '.jd-header h1', 'header h1'],
      company: ['[class*="jd-header-comp-name"] a', '[class*="jd-header-comp-name"]', '.jd-header-comp-name a'],
      location: ['[class*="jhc__location"]', '.location .loc', '[class*="location"] a'],
      description: ['[class*="JDC__dang-inner-html"]', '[class*="job-desc-container"]', '.job-desc', '.dang-inner-html'],
      salary: ['[class*="jhc__salary"]', '.salary'],
      externalId: () => (location.pathname.match(/-(\d{9,})(?:\?|$|\/)/) || [])[1],
    },
    {
      id: 'glassdoor', host: /(^|\.)glassdoor\.[a-z.]+$/,
      title: ['[data-test="job-title"]', 'h1[id^="jd-job-title"]', '[class*="JobDetails_jobTitle"]', '.css-1vg6q84', 'h1'],
      company: ['[data-test="employer-name"]', '[class*="EmployerProfile_employerName"]', '[class*="EmployerProfile_profileContainer"] h4', '.css-87uc0g'],
      location: ['[data-test="location"]', '[class*="JobDetails_location"]', '.css-56kyx5'],
      description: ['[class*="JobDetails_jobDescription"]', '.jobDescriptionContent', '[data-test="jobDescriptionContent"]', '#JobDescriptionContainer'],
      salary: ['[data-test="detailSalary"]', '[class*="SalaryEstimate_salaryRange"]'],
      externalId: () => new URL(location.href).searchParams.get('jl') || (location.pathname.match(/JV_[^_]*_?KO[^_]*_KE[^.]*?(\d{6,})\.htm/) || [])[1],
    },
    {
      id: 'wellfound', host: /(^|\.)(wellfound|angel)\.co(m)?$/,
      title: ['[class*="styles_jobTitle"]', 'h1[class*="title"]', 'main h1', 'h1'],
      company: ['a[href^="/company/"] h2', 'a[href^="/company/"]', '[class*="styles_companyName"]'],
      location: ['[class*="styles_location"]', '[class*="locations"]'],
      description: ['[class*="styles_description"]', '[class*="job-description"]', '[data-test="JobDescription"]'],
      salary: ['[class*="styles_compensation"]'],
      externalId: () => (location.pathname.match(/\/jobs\/(\d+)/) || [])[1],
    },
    {
      id: 'foundit', host: /(^|\.)(foundit\.(in|sg|ae|my|ph|hk|com)|monsterindia\.com)$/,
      title: ['.job-tittle h1', '.jd-header h1', '[class*="jobTitle"]', 'h1'],
      company: ['.job-tittle .company-name', '.jd-header .company-name', '[class*="companyName"]', '.company-name a', '.company-name'],
      location: ['.job-tittle .details .loc', '[class*="jobLocation"]', '.details .loc a', '.location'],
      description: ['.job-description-content', '#jobDescription', '[class*="jobDescription"]', '.jd-desc'],
      salary: ['[class*="salary"]'],
      externalId: () => (location.pathname.match(/-(\d{6,})(?:\?|$|\/)/) || [])[1] || new URL(location.href).searchParams.get('jobId'),
    },
    {
      id: 'instahyre', host: /(^|\.)instahyre\.com$/,
      title: ['.job-title h1', '.job-title', '[class*="job-title"]', '.profile-title', 'h1'],
      company: ['.company-name', '[class*="company-name"]', '.employer-name'],
      location: ['.job-locations', '[class*="location"]'],
      description: ['.job-description', '[class*="job-description"]', '.description'],
      externalId: () => (location.pathname.match(/\/job-(\d+)/) || [])[1],
    },
  ];

  const ATS = [
    [/(^|\.)greenhouse\.io$/, 'greenhouse'], [/(^|\.)lever\.co$/, 'lever'], [/(^|\.)ashbyhq\.com$/, 'ashby'], [/(^|\.)workable\.com$/, 'workable'],
    [/(^|\.)smartrecruiters\.com$/, 'smartrecruiters'], [/(^|\.)recruitee\.com$/, 'recruitee'], [/(^|\.)myworkdayjobs\.com$/, 'workday'],
  ];

  function fromSite(site) {
    if (!site) return null;
    const salaryText = site.salary ? qText(site.salary) : '';
    const id = site.externalId ? site.externalId() : '';
    return {
      title: qText(site.title),
      company: qText(site.company).replace(/\s*·.*$/, ''),
      location: qText(site.location).replace(/^·\s*/, ''),
      description: qBlock(site.description),
      salaryText: salaryText && /\d/.test(salaryText) && salaryText.length < 120 ? salaryText : '',
      externalId: id || '',
      url: site.canonical ? site.canonical(id) : '',
    };
  }

  // ------------------------------------------------------------------ 3. generic
  function largestTextBlock() {
    const cands = [...document.querySelectorAll('[class*="description" i],[id*="description" i],[class*="job-details" i],[class*="jobdetails" i],[class*="posting" i],[class*="content" i],article,main,section')]
      .filter((e) => visible(e) && !e.closest('header,nav,footer,form,[role=navigation]'));
    let best = null; let bestScore = 0;
    for (const e of cands) {
      const t = (e.innerText || '').trim();
      if (t.length < 200) continue;
      const kw = (t.match(/\b(responsibilit|requirement|qualification|experience|skills|about (the|this) (role|job|position)|what you('ll| will) do|you will|we are looking|benefits)/gi) || []).length;
      // Prefer dense, keyword-rich blocks over the whole <main>.
      const links = e.querySelectorAll('a').length;
      const score = Math.min(t.length, 15000) / 100 + kw * 25 - links * 2 + (/description/i.test(`${e.className} ${e.id}`) ? 60 : 0);
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best ? nodeText(best) : '';
  }
  function genericTitle() {
    const h1 = qText(['main h1', 'article h1', '[class*="job-title" i]', '[class*="jobtitle" i]', '[class*="posting-headline" i] h2', 'h1']);
    if (h1 && h1.length < 200) return h1;
    const og = meta('og:title') || document.title;
    return oneLine(og.split(/\s+[|–—]\s+|\s+-\s+(?=[^-]+$)/)[0]);
  }
  function genericCompany() {
    const sel = qText(['[class*="company-name" i]', '[class*="companyName" i]', '[class*="employer" i]', '[itemprop="hiringOrganization"]', '[data-company]']);
    if (sel && sel.length < 100) return sel;
    const site = meta('og:site_name');
    if (site && !/careers?|jobs?$/i.test(site)) return site;
    const t = document.title.split(/\s+[|–—-]\s+/);
    if (t.length > 1) { const last = t[t.length - 1].replace(/\b(careers?|jobs?)\b/ig, '').trim(); if (last && last.length < 60) return last; }
    // greenhouse/lever/ashby boards: company slug in the path
    const slug = (location.pathname.match(/^\/([a-z0-9-]{2,40})\//i) || [])[1];
    if (slug && ATS.some(([re]) => re.test(location.hostname))) return slug.replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
    return site || location.hostname.replace(/^(www|jobs|careers|boards|apply)\./, '').split('.')[0].replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }
  function genericLocation() {
    const t = qText(['[class*="location" i]:not(nav *)', '[itemprop="jobLocation"]', '[data-testid*="location" i]', '.posting-categories .location', '[class*="workplace" i]']);
    return t && t.length < 140 ? t : '';
  }

  // ------------------------------------------------------------------ apply URL, embedded forms, form detection
  function applyLink() {
    const links = [...document.querySelectorAll('a[href]')].filter(visible);
    const a = links.find((x) => /^\s*(apply( now| for this (job|position|role))?|easy apply|apply on company (site|website)|submit (an )?application|i'?m interested)\s*$/i.test(x.innerText || x.getAttribute('aria-label') || ''));
    const href = a ? abs(a.getAttribute('href')) : '';
    return href && !/^javascript:/i.test(href) ? href : '';
  }
  function embeddedForms() {
    return [...document.querySelectorAll('iframe[src]')]
      .map((f) => abs(f.getAttribute('src')))
      .filter((u) => u && /greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|recruitee\.com|myworkdayjobs\.com|icims\.com|jobvite\.com|bamboohr\.com|teamtailor\.com|personio|successfactors|taleo/i.test(u))
      .filter((u, i, arr) => arr.indexOf(u) === i).slice(0, 4);
  }
  function formInfo() {
    const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=search]):not([type=password]),select,textarea')].filter((e) => visible(e) || e.type === 'file');
    const hasFile = fields.some((f) => f.type === 'file');
    const hasEmail = fields.some((f) => f.type === 'email' || /email/i.test(`${f.name} ${f.id} ${f.getAttribute('autocomplete') || ''}`));
    return { fieldCount: fields.length, hasResumeUpload: hasFile, looksLikeApplication: fields.length >= 3 && (hasFile || hasEmail) };
  }

  // ------------------------------------------------------------------ main
  function extract() {
    const host = location.hostname.replace(/^www\./, '');
    const site = SITES.find((s) => s.host.test(host));
    const ats = (ATS.find(([re]) => re.test(host)) || [])[1] || null;
    const parts = [];
    const ld = fromJsonLd(); if (ld) parts.push(['json-ld', ld]);
    const st = fromSite(site); if (st) parts.push([site.id, st]);
    const generic = {
      title: genericTitle(), company: genericCompany(), location: genericLocation(), description: '',
      companyLogo: abs(meta('og:image')) || '',
    };
    parts.push(['generic', generic]);
    const pick = (k) => { for (const [, p] of parts) { const v = p[k]; if (v != null && v !== '' && !(typeof v === 'number' && Number.isNaN(v))) return v; } return k === 'description' ? largestTextBlock() : ''; };
    const used = new Set();
    const pickT = (k) => { for (const [name, p] of parts) { const v = p[k]; if (v != null && v !== '') { used.add(name); return v; } } if (k === 'description') { used.add('generic'); return largestTextBlock(); } return ''; };

    const title = pickT('title');
    const company = pickT('company');
    let loc = pickT('location');
    let description = pickT('description');
    if (description.length > 12000) description = `${description.slice(0, 11990)}…`;
    const canonicalLink = (document.querySelector('link[rel="canonical"]') || {}).href || '';
    const pageUrl = pick('url') || (canonicalLink && !/\/jobs\/?$|\/search/i.test(canonicalLink) ? canonicalLink : '') || location.href;
    const remote = !!pick('remote') || /\b(remote|work from home|wfh|anywhere)\b/i.test(`${loc} ${title}`);
    if (!loc && remote) loc = 'Remote';
    const form = formInfo();
    const job = {
      title: title.slice(0, 300),
      company: company.slice(0, 200),
      location: loc.slice(0, 300),
      remote,
      description,
      url: pageUrl,
      applyUrl: ats ? location.href : (applyLink() || pageUrl),
      companyLogo: pick('companyLogo') || '',
      employmentType: pick('employmentType') || '',
      salaryText: pick('salaryText') || '',
      salaryMin: pick('salaryMin') || null,
      salaryMax: pick('salaryMax') || null,
      salaryCurrency: pick('salaryCurrency') || '',
      postedAt: pick('postedAt') || null,
      externalId: pick('externalId') || '',
      source: site ? site.id : ats || 'web',
      extractedBy: [...used],
    };
    const signals = (description.match(/\b(responsibilit|requirement|qualification|years of experience|what you('ll| will) do|about the role|apply)/gi) || []).length;
    const isJobPage = !!ld || (!!site && !!title && description.length > 150) || (!!title && description.length > 400 && signals >= 2) || (!!ats && !!title);
    const confidence = ld ? 'high' : site && job.title && job.company ? 'high' : isJobPage ? 'medium' : 'low';
    return { ok: !!job.title, isJobPage, confidence, job, form, embeddedForms: embeddedForms(), page: { url: location.href, host, title: document.title } };
  }

  globalThis.__apExtract = extract;
})();
