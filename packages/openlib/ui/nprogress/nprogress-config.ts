import NProgress from "nprogress";

/**
 * NProgress Configuration
 * Customize the loading bar appearance and behavior
 */
export const configureNProgress = () => {
  NProgress.configure({
    // Show spinner on the right side
    showSpinner: true,
    // Speed of the progress bar animation (in ms)
    speed: 400,
    // Minimum percentage used upon starting
    minimum: 0.08,
    // Easing function for animations
    easing: "ease",
    // Adjust animation speed based on progress (slow down as we progress)
    trickle: true,
    // How often to trickle in ms
    trickleSpeed: 200,
  });
};
