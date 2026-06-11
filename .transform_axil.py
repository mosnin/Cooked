#!/usr/bin/env python3
"""Persona split: Koala(persona) -> Axil inside in-scope files only.
Guards protect product/brand/config tokens that must stay KOALA_/koala.
"""
import re, sys, pathlib

ROOT = pathlib.Path('/home/user/Cooked')

# ---- Protected tokens: replace with sentinels first, restore at the end ----
# These must NOT be touched by any koala->axil rule.
PROTECT = [
    '/manager/koala',        # un-renamed manager route — must stay
    'KOALA_AVATAR',          # lib/colors.ts BrandOrangeContext (config)
    'KOALA_BAR_MAX',         # lib/geometry.ts layout const (config)
    'koalaErrorMessage',     # lib/ai-tools/koala-voice.ts (out of scope export)
    'koala-voice',           # module path (out of scope)
    'koala-thinking-shimmer',# global CSS class (app/globals.css out of scope)
    'koala-cursor',          # global CSS class
    'koala-bar-input',       # internal DOM id, unreferenced
    'koala.bar.',            # sessionStorage key prefix
    'usekoala',              # brand domain (usekoala.com)
    'koala-diagram-shell',   # marketing component (out of scope)
    "id: 'koala'",           # inngest product id
    "'koala'",               # agentType enum value literal
    "landKoalaError",        # internal helper wrapping koalaErrorMessage (keep)
]

def protect(text):
    for i, tok in enumerate(PROTECT):
        text = text.replace(tok, f'\x00PROT{i}\x00')
    return text

def unprotect(text):
    for i, tok in enumerate(PROTECT):
        text = text.replace(f'\x00PROT{i}\x00', tok)
    return text

# ---- Identifier renames (word-boundary, applied to protected text) ----
# PascalCase persona identifiers
PASCAL = [
    'KoalaActivityRedirect','KoalaAssessmentCardProps','KoalaAssessmentCard',
    'KoalaAuthoredDot','KoalaAvatarProps','KoalaAvatar','KoalaBadgeProps','KoalaBadge',
    'KoalaBriefPage','KoalaBriefing','KoalaBar','KoalaDraftsPage','KoalaFullDayAlias',
    'KoalaHistoryPage','KoalaInboxPage','KoalaLoading','KoalaMemoryRedirect',
    'KoalaPageShellProps','KoalaPageShell','KoalaPage','KoalaPowerToggle',
    'KoalaPromptBoxProps','KoalaPromptBox','KoalaTodayRedirect','KoalaWordmarkInline',
    'KoalaWorkspaceProps','KoalaWorkspace',
    'HowKoalaWorksTip',
]
# camelCase / local identifiers (persona, in-scope only)
CAMEL = ['koalaBaseUrl','koalaBase','koalaHref','hidingForKoalaNav','isKoalaLink','onKoalaPage']

# import path segments for renamed files
PATHSEG = {
    '@/components/koala/koala-workspace': '@/components/axil/axil-workspace',
    '@/components/koala/koala-page-shell': '@/components/axil/axil-page-shell',
    '@/components/koala/koala-bar': '@/components/axil/axil-bar',
    '@/components/koala/koala-power-toggle': '@/components/axil/axil-power-toggle',
    '@/components/koala/how-koala-works-tip': '@/components/axil/how-axil-works-tip',
    '@/components/agent/koala-assessment-card': '@/components/agent/axil-assessment-card',
    '@/components/agent/koala-authored': '@/components/agent/axil-authored',
    '@/components/agent/koala-avatar': '@/components/agent/axil-avatar',
    '@/components/agent/koala-briefing': '@/components/agent/axil-briefing',
    '@/components/ui/koala-prompt-box': '@/components/ui/axil-prompt-box',
    # relative imports of renamed agent files (e.g. agent-mission-control)
    './koala-assessment-card': './axil-assessment-card',
    './koala-authored': './axil-authored',
    './koala-avatar': './axil-avatar',
    './koala-briefing': './axil-briefing',
    # remaining (non-renamed) files in the moved dir: just the dir prefix
    '@/components/koala/': '@/components/axil/',
    # lib/koala moved to lib/axil
    '@/lib/koala/': '@/lib/axil/',
    "'@/lib/koala'": "'@/lib/axil'",
    # API + app route imports in tests
    '@/app/api/koala/': '@/app/api/axil/',
}

# Route/path literal replacement: any remaining '/koala' segment is a rep
# route or api path that physically moved to '/axil'. '/manager/koala' is in
# PROTECT (sentinel) so it is never seen here. Import paths (@/components/koala,
# @/lib/koala) are converted by PATHSEG first.
def route_fix(text):
    return text.replace('/koala', '/axil')

# Persona user-visible strings / words. Applied last as a general Koala->Axil,
# but ONLY after the targeted rules above, and only in files we deem persona.
# We do a final word-level Koala->Axil and koala->axil for prose, guarded by PROTECT.

def transform(path: pathlib.Path, persona_prose: bool):
    raw = path.read_text()
    text = protect(raw)

    # import path segments first (longest first so specific file paths win over dir)
    for k in sorted(PATHSEG, key=len, reverse=True):
        text = text.replace(k, PATHSEG[k])
    # then any remaining /koala route/api literal -> /axil
    text = route_fix(text)
    # PascalCase identifiers (longest first)
    for ident in sorted(PASCAL, key=len, reverse=True):
        text = re.sub(r'\b'+ident+r'\b', 'Axil'+ident[5:], text)
    # camelCase identifiers
    for ident in sorted(CAMEL, key=len, reverse=True):
        # map koalaBase->axilBase, hidingForKoalaNav->hidingForAxilNav, etc.
        new = ident.replace('Koala','Axil').replace('koala','axil')
        text = re.sub(r'\b'+ident+r'\b', new, text)

    if persona_prose:
        # General persona word replacement in remaining prose/strings/comments.
        # Guards already protected. Replace standalone Koala / koala tokens.
        text = re.sub(r'\bKoala\b', 'Axil', text)
        text = re.sub(r'\bkoala\b', 'axil', text)

    text = unprotect(text)
    if text != raw:
        path.write_text(text)
        return True
    return False

if __name__ == '__main__':
    files = [pathlib.Path(p) for p in sys.argv[2:]]
    persona = sys.argv[1] == 'prose'
    changed = []
    for f in files:
        if transform(f, persona):
            changed.append(str(f))
    for c in changed:
        print('CHANGED', c)
    print(f'--- {len(changed)} files changed ---')
