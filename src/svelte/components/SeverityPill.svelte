<script>
  let { severity = 'Observe' } = $props();

  let normalized = $derived((severity || 'Observe').toLowerCase().includes('critical') ? 'critical'
    : (severity || '').toLowerCase().includes('elevated') ? 'elevated'
    : 'observe');

  let label = $derived(normalized === 'critical' ? 'Critical'
    : normalized === 'elevated' ? 'Elevated'
    : 'Observe');
</script>

<span class="pill severity-{normalized}">{label}</span>
