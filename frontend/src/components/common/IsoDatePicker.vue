<script setup>
import { computed } from 'vue'
import DatePicker from 'primevue/datepicker'

const props = defineProps({
  modelValue: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue', 'change'])

function parseIsoDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isFinite(date.getTime()) ? date : null
}

function toIsoDate(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return ''
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const dateValue = computed({
  get: () => parseIsoDate(props.modelValue),
  set: (value) => {
    const nextValue = toIsoDate(value)
    emit('update:modelValue', nextValue)
    emit('change', nextValue)
  },
})
</script>

<template>
  <DatePicker
    v-model="dateValue"
    date-format="dd/mm/yy"
    show-icon
    fluid
    v-bind="$attrs"
  />
</template>
