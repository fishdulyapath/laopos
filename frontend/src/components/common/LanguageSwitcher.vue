<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Select from 'primevue/select'
import { defaultLocale, languageOptions, setLocale } from '@/i18n'

const { locale, t } = useI18n()

const selectedLocale = computed({
  get: () => locale.value,
  set: (value) => setLocale(value),
})

const options = computed(() => languageOptions.map((item) => ({
  ...item,
  label: item.nativeLabel || t(item.labelKey),
  displayLabel: item.nativeLabel || t(item.labelKey),
})))

const selectedOption = computed(() => options.value.find((item) => item.value === selectedLocale.value) || options.value.find((item) => item.value === defaultLocale) || options.value[0])
</script>

<template>
  <label class="language-switcher flag-language-switcher" :aria-label="t('language.label')">
    <Select
      v-model="selectedLocale"
      :options="options"
      option-label="displayLabel"
      option-value="value"
      class="language-select flag-language-select"
      :aria-label="`${t('language.label')}: ${selectedOption?.label || ''}`"
    >
      <template #value>
        <span class="language-value" :title="selectedOption?.label" :aria-label="selectedOption?.label">
          <span class="language-flag-icon" :class="selectedOption?.flagClass" aria-hidden="true"></span>
          <span class="language-name">{{ selectedOption?.label }}</span>
        </span>
      </template>
      <template #option="{ option }">
        <span class="language-option" :title="option.label" :aria-label="option.label">
          <span class="language-flag-icon" :class="option.flagClass" aria-hidden="true"></span>
          <span class="language-name">{{ option.label }}</span>
        </span>
      </template>
    </Select>
  </label>
</template>

<style scoped>
.language-switcher {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.language-select {
  min-width: 7.5rem;
}

.flag-language-select {
  min-width: 7.25rem;
}

.language-select :deep(.p-select-label) {
  padding-block: 0.45rem;
}

.flag-language-select :deep(.p-select-label) {
  display: inline-flex;
  justify-content: flex-start;
  padding-inline: 0.7rem 0.35rem;
}

.language-value,
.language-option {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.language-flag-icon {
  position: relative;
  display: inline-flex;
  justify-content: center;
  width: 1.55rem;
  height: 1.08rem;
  flex: 0 0 auto;
  overflow: hidden;
  border: 1px solid rgba(15, 23, 42, 0.18);
  border-radius: 2px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.14);
}

.flag-th {
  background: linear-gradient(to bottom, #a51931 0 16.666%, #f4f5f8 16.666% 33.333%, #2d2a4a 33.333% 66.666%, #f4f5f8 66.666% 83.333%, #a51931 83.333% 100%);
}

.flag-lo {
  background: linear-gradient(to bottom, #ce1126 0 25%, #002868 25% 75%, #ce1126 75% 100%);
}

.flag-lo::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: #ffffff;
  transform: translate(-50%, -50%);
}

.flag-gb {
  background: #012169;
}

.flag-gb::before,
.flag-gb::after {
  content: "";
  position: absolute;
  inset: 0;
}

.flag-gb::before {
  background:
    linear-gradient(32deg, transparent 0 40%, #ffffff 40% 46%, #c8102e 46% 53%, #ffffff 53% 59%, transparent 59%),
    linear-gradient(-32deg, transparent 0 40%, #ffffff 40% 46%, #c8102e 46% 53%, #ffffff 53% 59%, transparent 59%);
}

.flag-gb::after {
  background:
    linear-gradient(to right, transparent 0 38%, #ffffff 38% 45%, #c8102e 45% 55%, #ffffff 55% 62%, transparent 62%),
    linear-gradient(to bottom, transparent 0 35%, #ffffff 35% 43%, #c8102e 43% 57%, #ffffff 57% 65%, transparent 65%);
}

.language-name {
  min-width: 0;
  color: inherit;
  font-weight: 800;
  line-height: 1.1;
  white-space: nowrap;
}
</style>
