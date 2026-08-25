module.exports = {
  apps: [
    {
      name: 'mzobs-backend',
      script: './server.js',
      // Cluster mode: PM2 forks one worker per CPU core and load-balances
      // between them. If one worker dies, the rest keep serving — a crash
      // no longer means downtime for every connected user.
      exec_mode: 'cluster',
      instances: 'max',
      env: {
        NODE_ENV: 'production',
      },
      // Sub-second restart on crash (uncaughtException, OOM, etc).
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      // Backs off between rapid repeat crashes instead of hot-looping.
      exp_backoff_restart_delay: 100,
      // Restart a worker if it leaks past this rather than letting it OOM
      // the host — cluster mode means the restart is invisible to traffic.
      max_memory_restart: '400M',
      // Give in-flight requests a chance to finish before a reload kills
      // the old worker (matches the SIGTERM handling in server.js).
      kill_timeout: 5000,
      wait_ready: false,
    },
  ],
}
