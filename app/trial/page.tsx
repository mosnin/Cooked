import { redirect } from 'next/navigation';

/**
 * /trial — legacy ad-landing URL.
 *
 * The page this carried was off-design-system and made claims the product
 * doesn't back: fabricated testimonials with invented names, an invented
 * adoption metric, and a "no card" trial promise that contradicts checkout
 * (the 7-day trial collects a card). External campaigns may still point at
 * the URL, so it stays alive as a redirect to the honest pricing page.
 */
export default function TrialPage() {
  redirect('/pricing');
}
