import com.sun.management.OperatingSystemMXBean;
import java.io.FileWriter;
import java.lang.management.ManagementFactory;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

/**
 * CPU-time instrumentation launcher. The runner sets this as the entry class
 * (ahead of the user's classes on the classpath). It captures the process CPU
 * baseline AFTER the JVM has booted, registers a shutdown hook that emits the
 * delta (so the reported CPU excludes JVM startup + class loading of the
 * bootstrap), then reflectively invokes the user's {@code Main.main(args)}.
 *
 * getProcessCpuTime() counts all threads, so a multi-threaded program is
 * measured correctly. The shutdown hook also runs on System.exit(), so a
 * program that exits explicitly is still measured (only Runtime.halt() / SIGKILL
 * skip it, in which case the runner falls back to %U+%S).
 */
public final class _RunnerMain {
  public static void main(String[] args) throws Exception {
    final OperatingSystemMXBean os =
        (OperatingSystemMXBean) ManagementFactory.getOperatingSystemMXBean();
    final long baseNanos = os.getProcessCpuTime();

    Runtime.getRuntime().addShutdownHook(new Thread(() -> {
      long deltaNanos = os.getProcessCpuTime() - baseNanos;
      if (deltaNanos < 0) {
        deltaNanos = 0;
      }
      try (FileWriter w = new FileWriter("/workspace/tmp/run-cpu.txt")) {
        w.write(String.format("%.6f", deltaNanos / 1.0e9));
      } catch (Exception ignored) {
        // Best-effort: the runner falls back to %U+%S if the file is missing.
      }
    }));

    Method main = Class.forName("Main").getMethod("main", String[].class);
    try {
      main.invoke(null, (Object) args);
    } catch (InvocationTargetException e) {
      // Surface the user's exception with a clean stack trace (no reflection
      // frames), then exit non-zero — the shutdown hook still emits the metric.
      Throwable cause = e.getCause() != null ? e.getCause() : e;
      cause.printStackTrace();
      System.exit(1);
    }
  }
}
