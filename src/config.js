// Seller configuration — fill these in before you publish a build.
// Create the products in Dodo Payments (or Polar), paste the hosted checkout links here.
// Dodo license keys are activated in-app automatically; offline keys come from `npm run license:issue`.
export const CONFIG = {
  brand: 'ApplyPilot',
  website: 'https://applypilot.app',
  supportEmail: 'support@applypilot.app',
  checkout: {
    proMonthly: '', // e.g. https://checkout.dodopayments.com/buy/pdt_xxx
    proYearly: '',
    sprint: '',
    lifetime: '',
  },
  customerPortal: '', // Dodo customer portal link for one-click cancel
};

export const PRICING = [
  { id: 'free', name: 'Free', price: '$0', inr: '₹0', period: 'forever', features: ['1 active campaign', '2 resumes', '10 applications / day', 'All 25+ job sources & 250 platforms', 'We fill, you click submit', '5 AI actions / day', 'Review queue, duplicate guard, blacklist'] },
  { id: 'pro', name: 'Pro', price: '$12', inr: '₹499', period: '/month', alt: 'or $79/yr · ₹2,999/yr', checkout: ['proMonthly', 'proYearly'], highlight: true, features: ['10 campaigns in parallel', '50 resumes, auto-picked per job', '120 applications / day', 'Full autopilot on Greenhouse, Lever, Ashby, Workable…', 'Up to 6 browser tabs at once', 'Unlimited AI tailoring & cover letters', 'Resume A/B analytics'] },
  { id: 'sprint', name: 'Sprint Pass', price: '$29', inr: '₹1,199', period: '90 days', alt: 'one-time · never auto-renews', checkout: ['sprint'], features: ['Everything in Pro for 90 days', 'Perfect for an active job hunt', 'No subscription to cancel'] },
  { id: 'lifetime', name: 'Lifetime', price: '$149', inr: '₹5,999', period: 'once', alt: 'launch price $99 · ₹3,999', checkout: ['lifetime'], features: ['Everything in Pro, forever', '10 browser tabs at once', 'All 1.x and 2.x updates', '3 PCs'] },
];
