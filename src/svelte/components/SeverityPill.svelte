<script>
  export let severity = 'Observe';

  $: normalized = (severity || 'Observe').toLowerCase().includes('critical') ? 'critical'
    : (severity || '').toLowerCase().includes('elevated') ? 'elevated'
    : 'observe';

  $: label = normalized === 'critical' ? 'Critical'
    : normalized === 'elevated' ? 'Elevated'
    : 'Observe';
</script>

<span class="pill severity-{normalized}">{label}</span>
