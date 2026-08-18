/**
 * Lightweight SFC (Single File Component) extractor for Vue 3 and Svelte.
 * Extracts `<script setup>` / `<script>` blocks and template component references without heavy external compilers.
 * @module @trench-xinxin/dsh-tool-lens/parsers/sfc-parser
 */

const NATIVE_HTML_TAGS = new Set([
  'html', 'head', 'body', 'title', 'meta', 'link', 'style', 'script', 'noscript',
  'div', 'span', 'p', 'a', 'b', 'i', 'u', 's', 'strong', 'em', 'small', 'mark',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'footer', 'nav', 'main', 'section', 'article', 'aside',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'form', 'input', 'textarea', 'button', 'select', 'optgroup', 'option', 'label', 'fieldset', 'legend',
  'img', 'audio', 'video', 'canvas', 'svg', 'path', 'g', 'circle', 'rect', 'line', 'polyline', 'polygon',
  'iframe', 'embed', 'object', 'param', 'picture', 'source', 'track',
  'slot', 'template', 'component', 'transition', 'transition-group', 'keep-alive', 'teleport', 'suspense',
])

export interface SFCExtractionResult {
  /** Combined JavaScript / TypeScript code extracted from `<script>` blocks */
  scriptContent: string
  /** Script language: 'ts' | 'js' */
  lang: 'ts' | 'js'
  /** Component names referenced in `<template>` tags (e.g., ['ChildButton', 'UserAvatar']) */
  templateComponents: string[]
  /** Total line count of the SFC */
  totalLines: number
}

/**
 * Converts a kebab-case tag name to PascalCase.
 * e.g., "my-button" -> "MyButton"
 */
export function kebabToPascal(str: string): string {
  return str
    .split('-')
    .filter(Boolean)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('')
}

/**
 * Parses a Vue SFC (.vue) or Svelte component (.svelte) content.
 */
export function extractSFCBlocks(content: string, filePath: string): SFCExtractionResult {
  const isVue = filePath.endsWith('.vue')
  const isSvelte = filePath.endsWith('.svelte')

  const scriptBlocks: string[] = []
  let detectedLang: 'ts' | 'js' = 'ts'

  // 1. Extract <script> blocks (supports <script setup lang="ts">, <script lang="ts">, <script>)
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let scriptMatch: RegExpExecArray | null

  while ((scriptMatch = scriptRegex.exec(content)) !== null) {
    const attrs = scriptMatch[1] || ''
    const body = scriptMatch[2] || ''

    if (attrs.includes('lang="js"') || attrs.includes("lang='js'")) {
      detectedLang = 'js'
    } else {
      detectedLang = 'ts'
    }

    scriptBlocks.push(body)
  }

  // 2. Extract <template> block and referenced custom components
  const templateComponents = new Set<string>()

  if (isVue) {
    const templateRegex = /<template\b[^>]*>([\s\S]*?)<\/template>/gi
    let templateMatch: RegExpExecArray | null
    while ((templateMatch = templateRegex.exec(content)) !== null) {
      const templateBody = templateMatch[1] || ''
      extractTagsFromTemplate(templateBody, templateComponents)
    }
  } else if (isSvelte) {
    // Svelte template is the markup outside of <script> and <style>
    const cleanMarkup = content
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    extractTagsFromTemplate(cleanMarkup, templateComponents)
  }

  const combinedScript = scriptBlocks.join('\n\n')
  const totalLines = content.split('\n').length

  return {
    scriptContent: combinedScript,
    lang: detectedLang,
    templateComponents: Array.from(templateComponents),
    totalLines,
  }
}

function extractTagsFromTemplate(markup: string, componentsSet: Set<string>): void {
  // Matches HTML tags like <MyComponent ...> or <my-component ...>
  const tagRegex = /<([a-zA-Z0-9_-]+)\b/g
  let tagMatch: RegExpExecArray | null

  while ((tagMatch = tagRegex.exec(markup)) !== null) {
    const rawTag = tagMatch[1]!
    const lowerTag = rawTag.toLowerCase()

    if (NATIVE_HTML_TAGS.has(lowerTag)) {
      continue
    }

    // PascalCase component (e.g. <HeaderNav />)
    if (/^[A-Z]/.test(rawTag)) {
      componentsSet.add(rawTag)
    } else if (rawTag.includes('-')) {
      // kebab-case component (e.g. <header-nav /> -> HeaderNav)
      componentsSet.add(rawTag)
      componentsSet.add(kebabToPascal(rawTag))
    }
  }
}
