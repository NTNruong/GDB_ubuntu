# NVIC — Nested Vectored Interrupt Controller

The NVIC manages interrupts and exceptions on Cortex-M processors. It supports
nested interrupts, dynamic priority assignment, and low-latency exception entry.

## Interrupt Priority

Each interrupt has a programmable priority. The number of priority bits is
implementation-defined (typically 3 to 8 bits), so portable code reads the
implemented bits rather than assuming a fixed width. Lower numerical priority
values mean higher urgency: priority 0 preempts priority 1.

Priority can be split into preempt-priority and sub-priority groups via the
Application Interrupt and Reset Control Register (AIRCR) priority grouping field.

## CMSIS API

`NVIC_SetPriority(IRQn, priority)` sets an interrupt's priority and
`NVIC_EnableIRQ(IRQn)` enables it in the controller. `NVIC_SetPriorityGrouping()`
configures how the priority field is split between preemption and sub-priority.
