diagram state "State Machine" {
    theme "sketchy-light"

    [*] --> pending: create
    pending --> active: start
    active --> paused: pause
    active --> completed: finish
    paused --> active: resume
    completed --> [*]: archive
}
