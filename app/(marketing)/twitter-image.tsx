/**
 * Twitter card image — same artwork as opengraph-image.tsx so the preview
 * is identical whether the link is shared on Twitter, Slack, LinkedIn, or
 * an iMessage. Re-exports the default OG generator to keep them in sync.
 */

export { default } from './opengraph-image';
export {
  runtime,
  alt,
  size,
  contentType,
} from './opengraph-image';
