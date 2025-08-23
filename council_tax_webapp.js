document.addEventListener("DOMContentLoaded", () => {
    // --- Core Data and Constants ---
    const AVERAGE_BAND_D = 2280;
    const BASE_BAND_H_TAX = 2 * AVERAGE_BAND_D;
    const BAND_H_START_VALUE = 1500000;
    const TOTAL_PROPERTIES_OVER_1_5M = 154000;
    const MAX_PRICE = 210000000;
    const SLIDER_MAX = 20000000;

    // Data for calculating effective rate
    const bandHBreakdown = {
        standard: 125000,
        single: 16000,
        disregarded: 2000,
        empty: 2000,
        second: 5000,
    };
    const totalPropertiesInBreakdown = Object.values(bandHBreakdown).reduce(
        (a, b) => a + b,
        0,
    );
    const weightedCharge =
        bandHBreakdown.standard * 1.0 +
        bandHBreakdown.single * 0.75 +
        bandHBreakdown.disregarded * 0.5 +
        bandHBreakdown.empty * 2.0 +
        bandHBreakdown.second * 2.0;
    const EFFECTIVE_RATE = weightedCharge / totalPropertiesInBreakdown;

    // --- State Management ---
    const initialState = {
        mode: "multiplier",
        percentType: "instead",
        bandBoundaries: [3000000, 5000000, 10000000],
        savedRateValues: {
            multiplier: [2, 2, 2, 2],
            percentage: [0, 0.5, 0.5, 0.5],
        },
    };
    // Use a deep copy for the working state
    let state = JSON.parse(JSON.stringify(initialState));

    // --- Formatting Helpers ---
    // --- Formatting Helpers ---
    const formatToMillions = (num) =>
        `£${(Math.round(num / 1000000) + 0).toLocaleString()}m`;
    const formatToCurrency = (num) => `£${Math.round(num).toLocaleString()}`;
    const formatSliderTooltip = (value) =>
        `£${(value / 1000000).toFixed(2)}m`.replace(".00", "");

    // --- Estimation Functions (Memoized) ---
    const estimationCache = new Map();

    // --- Full Estimation Functions ---
    // NOTE: This entire block is moved up to ensure all functions and
    // dependent constants are defined before they are called by UI initializers.
    function linearInterpolate(x, xp, fp) {
        if (x <= xp[0]) return fp[0];
        if (x >= xp[xp.length - 1]) return fp[xp.length - 1];
        for (let i = 0; i < xp.length - 1; i++) {
            if (x >= xp[i] && x <= xp[i + 1]) {
                return (
                    fp[i] +
                    ((x - xp[i]) * (fp[i + 1] - fp[i])) / (xp[i + 1] - xp[i])
                );
            }
        }
        return fp[fp.length - 1];
    }

    /**
     * Estimates the number of properties held in trusts/companies (ATED)
     * with a value between a lower and upper bound.
     */
    function estimatePropertiesFromAted(lower, upper) {
        // --- Constants and Configuration ---
        const MIN_LOWER_BOUND = 1500000;
        const VALUE_CAP = 210000000; // Matches MAX_PRICE

        // Data points for interpolation (Value, Cumulative Count > Value)
        const INTERP_VALUES = [
            1000000, 2000000, 5000000, 10000000, 20000000,
        ];
        const INTERP_CUMULATIVE_COUNTS = [3230, 1740, 680, 270, 120];

        // Pareto distribution parameters for values > £20m
        const PARETO_Xm = 20000000;
        const PARETO_N = 120;
        const PARETO_ALPHA = 1.176;

        // --- Input Validation ---
        if (upper < MIN_LOWER_BOUND) {
            return 0;
        }
        lower = Math.max(lower, MIN_LOWER_BOUND);

        if (upper < lower) {
            return 0;
        }

        // --- Helper Function for Estimation ---
        const getCumulativeCount = (value) => {
            const cappedValue = Math.min(value, VALUE_CAP);
            if (cappedValue <= PARETO_Xm) {
                return linearInterpolate(
                    cappedValue,
                    INTERP_VALUES,
                    INTERP_CUMULATIVE_COUNTS,
                );
            } else {
                return PARETO_N * (PARETO_Xm / cappedValue) ** PARETO_ALPHA;
            }
        };

        // --- Main Calculation ---
        const countAboveLower = getCumulativeCount(lower);
        const countAboveUpper = getCumulativeCount(upper);
        return countAboveLower - countAboveUpper;
    }

    // Calculate the total number of ATED properties to adjust the stamp duty scaling factor.
    const TOTAL_ATED_PROPERTIES_OVER_1_5M = estimatePropertiesFromAted(1500000, MAX_PRICE);

    // The new total for stamp duty properties is the overall total minus the ATED properties.
    const ADJUSTED_STAMP_DUTY_PROPERTIES_OVER_1_5M = 
        TOTAL_PROPERTIES_OVER_1_5M - TOTAL_ATED_PROPERTIES_OVER_1_5M;

    function getPropertyDistribution() {
        const cacheKey = "distribution";
        if (estimationCache.has(cacheKey)) return estimationCache.get(cacheKey);
        const original_total_over_1_5m = 10600.0,
            original_cumulative_counts = [0, 5100, 8200, 9200, 9600, 10300],
            original_count_over_10m = 300.0;
        
        // Use the adjusted total for scaling to avoid double-counting.
        const scaling_factor =
            ADJUSTED_STAMP_DUTY_PROPERTIES_OVER_1_5M / original_total_over_1_5m;

        const scaled_cumulative_counts = original_cumulative_counts.map(
                (c) => c * scaling_factor,
            ),
            scaled_total_count_over_10m =
                original_count_over_10m * scaling_factor;
        const known_prices_m = [1.5, 2.0, 3.0, 4.0, 5.0, 10.0],
            alpha = 1.736966;
        const log_prices = known_prices_m.map((p) => Math.log(p)),
            log_counts = scaled_cumulative_counts.map((c) => Math.log1p(c));
        const get_cumulative_count_at_price = (price_gbp) => {
            price_gbp = Math.min(price_gbp, MAX_PRICE);
            const price_m = price_gbp / 1000000;
            if (price_m <= 10.0)
                return Math.expm1(
                    linearInterpolate(
                        Math.log(price_m),
                        log_prices,
                        log_counts,
                    ),
                );
            else {
                const max_price_m = MAX_PRICE / 1000000;
                const numerator = 10.0 ** -alpha - price_m ** -alpha,
                    denominator = 10.0 ** -alpha - max_price_m ** -alpha;
                return (
                    scaled_cumulative_counts[
                        scaled_cumulative_counts.length - 1
                    ] +
                    scaled_total_count_over_10m * (numerator / denominator)
                );
            }
        };
        estimationCache.set(cacheKey, get_cumulative_count_at_price);
        return get_cumulative_count_at_price;
    }

    function estimatePropertiesFromStampReturns(lower_bound, upper_bound) {
        // 1. Estimate from stamp duty data (flow), now correctly scaled.
        const get_cumulative_count_at_price = getPropertyDistribution();
        const clamped_lower = Math.max(lower_bound, BAND_H_START_VALUE);
        const clamped_upper = isFinite(upper_bound) ? upper_bound : MAX_PRICE;
        const stampDutyEstimate =
            get_cumulative_count_at_price(clamped_upper) -
            get_cumulative_count_at_price(clamped_lower);

        // 2. Estimate from ATED data (stock).
        const atedEstimate = estimatePropertiesFromAted(lower_bound, upper_bound);

        // 3. Return the combined total.
        return stampDutyEstimate + atedEstimate;
    }

    function estimateAverageValueInBand(lower_bound, upper_bound) {
        const cacheKey = `avg-${lower_bound}-${upper_bound}`;
        if (estimationCache.has(cacheKey)) return estimationCache.get(cacheKey);
        lower_bound = Math.max(lower_bound, BAND_H_START_VALUE);
        upper_bound = isFinite(upper_bound) ? upper_bound : MAX_PRICE;
        const totalProperties = estimatePropertiesFromStampReturns(
            lower_bound,
            upper_bound,
        );
        if (totalProperties < 1) return (lower_bound + upper_bound) / 2;
        let totalValue = 0;
        const steps = 100,
            stepSize = (upper_bound - lower_bound) / steps;
        for (let i = 0; i < steps; i++) {
            const slice_low = lower_bound + i * stepSize,
                slice_high = slice_low + stepSize;
            totalValue +=
                estimatePropertiesFromStampReturns(slice_low, slice_high) *
                (slice_low + stepSize / 2);
        }
        const averageValue = totalValue / totalProperties;
        estimationCache.set(cacheKey, averageValue);
        return averageValue;
    }
    
    // --- DOM Element References ---
    const dom = {
        revenueDifference: document.getElementById("revenue-difference"),
        rateHeader: document.getElementById("rate-header"),
        percentageOptions: document.getElementById("percentage-options"),
        modeRadios: document.querySelectorAll('input[name="mode"]'),
        percentTypeRadios: document.querySelectorAll(
            'input[name="percent-type"]',
        ),
        bandSlider: document.getElementById("band-slider"),

        bands: Array.from({ length: 4 }, (_, i) => {
            const slider = document.querySelector(
                `.rate-slider[data-band="${i}"]`,
            );
            const cell = slider.parentElement;
            return {
                props: document.getElementById(`h${i + 1}-props`),
                avgTax: document.getElementById(`h${i + 1}-avg-tax`),
                revenue: document.getElementById(`h${i + 1}-revenue`),
                slider: slider,
                rateVal: cell.querySelector(".rate-val"),
                rateSuffix: cell.querySelector(".rate-suffix"),
            };
        }),
        bandDisplays: {
            h1Top: document.getElementById("h1-top-display"),
            h2Low: document.getElementById("h2-low-display"),
            h2Top: document.getElementById("h2-top-display"),
            h3Low: document.getElementById("h3-low-display"),
            h3Top: document.getElementById("h3-top-display"),
            h4Low: document.getElementById("h4-low-display"),
        },
    };

    // --- Calculations & UI Updates ---
    const BASE_REVENUE =
        TOTAL_PROPERTIES_OVER_1_5M * BASE_BAND_H_TAX * EFFECTIVE_RATE;

    // Recalculate revenue differences and refresh all band displays
    function update() {
        let totalNewRevenue = 0;
        const boundaries = [
            BAND_H_START_VALUE,
            ...state.bandBoundaries,
            Infinity,
        ];

        dom.bandDisplays.h1Top.textContent = formatSliderTooltip(boundaries[1]);
        dom.bandDisplays.h2Low.textContent = formatSliderTooltip(boundaries[1]);
        dom.bandDisplays.h2Top.textContent = formatSliderTooltip(boundaries[2]);
        dom.bandDisplays.h3Low.textContent = formatSliderTooltip(boundaries[2]);
        dom.bandDisplays.h3Top.textContent = formatSliderTooltip(boundaries[3]);
        dom.bandDisplays.h4Low.textContent = formatSliderTooltip(boundaries[3]);

        for (let i = 0; i < dom.bands.length; i++) {
            const band = dom.bands[i];
            const rate = parseFloat(band.slider.value);
            band.rateVal.textContent = rate.toFixed(1);

            const propertyCount = estimatePropertiesFromStampReturns(
                boundaries[i],
                boundaries[i + 1],
            );
            let bandRevenue = 0;
            let avgIncrease = 0;

            if (propertyCount > 0) {
                let totalAvgTax = 0;
                if (state.mode === "multiplier") {
                    totalAvgTax = rate * AVERAGE_BAND_D;
                } else {
                    // Marginal percentage: apply each band's rate only to value *within* that band
                    const avgValue = estimateAverageValueInBand(
                        boundaries[i],
                        boundaries[i + 1],
                    );
                    const rates = dom.bands.map(
                        (b) => parseFloat(b.slider.value) / 100,
                    );
                    let marginalTax = 0;
                    for (let k = 0; k < i; k++) {
                        const lower = boundaries[k];
                        const upper = boundaries[k + 1];
                        const width = Math.max(
                            0,
                            Math.min(upper, avgValue) - lower,
                        );
                        marginalTax += rates[k] * width;
                    }
                    const currentExcess = Math.max(0, avgValue - boundaries[i]);
                    marginalTax += rates[i] * currentExcess;
                    totalAvgTax = BASE_BAND_H_TAX + marginalTax;
                }
                avgIncrease = totalAvgTax - BASE_BAND_H_TAX;
                bandRevenue = propertyCount * avgIncrease * EFFECTIVE_RATE;
            }

            totalNewRevenue += bandRevenue;

            band.props.textContent = Math.round(propertyCount).toLocaleString();
            band.avgTax.textContent = formatToCurrency(avgIncrease);
            band.revenue.textContent = formatToMillions(bandRevenue);
        }

        const difference = totalNewRevenue;
        dom.revenueDifference.textContent = formatToMillions(difference);
    }

    // Switch between multiplier and percentage modes
    function handleModeChange() {
        state.mode = document.querySelector('input[name="mode"]:checked').value;
        const isMultiplier = state.mode === "multiplier";

        dom.percentageOptions.classList.toggle("hidden", isMultiplier);
        dom.rateHeader.textContent = isMultiplier
            ? "Multiplier (vs Band D)"
            : "Tax Rate (%)";

        const savedValues = state.savedRateValues[state.mode];

        dom.bands.forEach((band, index) => {
            const slider = band.slider;
            if (isMultiplier) {
                slider.min = 2;
                slider.max = 12;
                slider.step = 0.1;
                band.rateSuffix.textContent = "x";
            } else {
                slider.min = 0.0;
                slider.max = 5.0;
                slider.step = 0.1;
                band.rateSuffix.textContent = "%";
            }
            slider.value = savedValues[index];
        });

        estimationCache.clear();
        update();
    }

    // --- Initial Setup ---
    noUiSlider.create(dom.bandSlider, {
        start: state.bandBoundaries,
        connect: [true, true, true, true],
        step: 250000,
        range: { min: BAND_H_START_VALUE, max: SLIDER_MAX },
        tooltips: { to: formatSliderTooltip, from: Number },
        pips: {
            mode: "values",
            values: [1500000, 5000000, 10000000, 15000000, 20000000],
            density: 4,
            format: { to: formatSliderTooltip, from: Number },
        },
    });

    // Add fixed "£1.5m" marker at the left edge (start of Band H)
    const fixedMarker = document.createElement("div");
    fixedMarker.className = "fixed-start-marker";
    fixedMarker.innerHTML = "<span>£1.5m</span>";
    dom.bandSlider.appendChild(fixedMarker);

    // --- Event Listeners ---
    dom.bandSlider.noUiSlider.on("update", (values) => {
        // Persist the latest band boundaries from the slider
        state.bandBoundaries = values.map((v) => parseFloat(v));
        update();
    });

    dom.modeRadios.forEach((radio) =>
        // React when the tax mode radio buttons change
        radio.addEventListener("change", handleModeChange),
    );
    dom.percentTypeRadios.forEach((radio) => {
        // Update calculations when the percentage type is changed
        radio.addEventListener("change", (e) => {
            state.percentType = e.target.value;
            update();
        });
    });

    document.querySelectorAll(".rate-slider").forEach((slider) => {
        // Save slider changes and recompute revenue
        slider.addEventListener("input", () => {
            const bandIndex = parseInt(slider.dataset.band, 10);
            const value = parseFloat(slider.value);
            state.savedRateValues[state.mode][bandIndex] = value;
            update();
        });
    });

    // Initialize the UI with stored defaults
    handleModeChange();
});

// --- Info button popovers (delegated; viewport clamped; click-anywhere closes) ---
(function () {
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    document.addEventListener("click", (e) => {
        const open = document.querySelector(".band-popover:not([hidden])");
        const btn = e.target.closest(".info-btn");
        if (open && !btn && !e.target.closest(".band-popover")) {
            open.setAttribute("hidden", "");
            return;
        }
        if (!btn) return;

        // Close any currently open popovers before opening a new one
        document
            .querySelectorAll(".band-popover:not([hidden])")
            .forEach((p) => p.setAttribute("hidden", ""));

        e.preventDefault();
        const idx = parseInt(btn.dataset.band, 10);
        const pop = document.getElementById(`band-popover-${idx}`);
        if (!pop) return;

        const row = btn.closest("tr");
        const bandName =
            row.querySelector(".band-name")?.textContent.trim() ||
            `H${idx + 1}`;
        const rangeCell = row.querySelector("td:nth-child(2)");
        const rangeText = rangeCell
            ? rangeCell.textContent.replace(/\s+/g, " ").trim()
            : "";
        const rateVal =
            row.querySelector(".rate-val")?.textContent.trim() || "";
        const rateSuffix =
            row.querySelector(".rate-suffix")?.textContent.trim() || "";
        const props =
            row.querySelector(`#h${idx + 1}-props`)?.textContent.trim() || "—";
        const avg =
            row.querySelector(`#h${idx + 1}-avg-tax`)?.textContent.trim() ||
            "—";
        const addl =
            row.querySelector(`#h${idx + 1}-revenue`)?.textContent.trim() ||
            "—";

        pop.querySelector(".band-title").textContent = bandName;
        pop.querySelector(".band-range").textContent = rangeText || "—";
        pop.querySelector(".band-rate").textContent = `${rateVal}${rateSuffix}`;
        pop.querySelector(".band-props").textContent = props;
        pop.querySelector(".band-avg").textContent = avg;
        pop.querySelector(".band-addl").textContent = addl;

        pop.removeAttribute("hidden");
        pop.style.position = "fixed";
        const rect = btn.getBoundingClientRect();
        const vw = window.innerWidth,
            vh = window.innerHeight;
        const pw = pop.offsetWidth || 320,
            ph = pop.offsetHeight || 160;

        let top = rect.bottom + 8;
        if (top + ph > vh - 12) top = Math.max(12, rect.top - ph - 8);
        let left = Math.max(12, Math.min(vw - pw - 12, rect.right - pw));

        pop.style.top = `${Math.round(top)}px`;
        pop.style.left = `${Math.round(left)}px`;

        pop.addEventListener("click", () => pop.setAttribute("hidden", ""), {
            once: true,
        });
    });
})();
