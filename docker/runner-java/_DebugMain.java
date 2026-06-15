import java.io.FileInputStream;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

/**
 * Debug launcher. Set as the java-debug {@code mainClass} (on /opt/runner, ahead of the
 * user's classes). java-debug's launch request has no clean way to feed the debuggee's
 * stdin from a file, so this wrapper redirects {@code System.in} from /workspace/stdin.txt
 * (mirroring the run-path _RunnerMain and the Python __debugpy_runner) and then reflectively
 * invokes the user's {@code Main.main(args)}. Breakpoints/stepping in Main.java still resolve
 * because java-debug maps source via the launch {@code sourcePaths}.
 */
public final class _DebugMain {
  public static void main(String[] args) throws Exception {
    try {
      System.setIn(new FileInputStream("/workspace/stdin.txt"));
    } catch (Exception ignored) {
      // No stdin file → leave the default System.in.
    }

    Method main = Class.forName("Main").getMethod("main", String[].class);
    try {
      main.invoke(null, (Object) args);
    } catch (InvocationTargetException e) {
      // Surface the user's exception with a clean stack trace (no reflection frames).
      Throwable cause = e.getCause() != null ? e.getCause() : e;
      cause.printStackTrace();
      System.exit(1);
    }
  }
}
