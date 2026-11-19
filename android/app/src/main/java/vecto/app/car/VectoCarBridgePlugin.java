package vecto.app.car;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "VectoCarBridge")
public class VectoCarBridgePlugin extends Plugin {
    public static final String PREFS_NAME = "vecto_car_prefs";
    public static final String KEY_JOBS_JSON = "jobs_json";
    public static final String KEY_ACTIVE_JOB_ID = "active_job_id";
    public static final String KEY_DRIVER_NAME = "driver_name";
    public static final String KEY_COMPANY_NAME = "company_name";
    public static final String KEY_PENDING_ACTION = "pending_action";
    public static final String KEY_PENDING_ACTIONS_QUEUE = "pending_actions_json";

    private static final int MAX_QUEUE_SIZE = 50;

    // Strong reference required: SharedPreferences stores listeners in a WeakHashMap.
    private SharedPreferences.OnSharedPreferenceChangeListener prefsListener;

    public static void enqueueCarAction(Context context, JSONObject action) {
        if (context == null || action == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        synchronized (VectoCarBridgePlugin.class) {
            String rawQueue = prefs.getString(KEY_PENDING_ACTIONS_QUEUE, "[]");
            JSONArray queue;
            try {
                queue = new JSONArray(rawQueue);
            } catch (JSONException e) {
                queue = new JSONArray();
            }

            if (queue.length() >= MAX_QUEUE_SIZE) {
                JSONArray trimmed = new JSONArray();
                for (int i = 1; i < queue.length(); i++) {
                    Object item = queue.opt(i);
                    if (item != null) trimmed.put(item);
                }
                queue = trimmed;
            }

            queue.put(action);
            prefs.edit()
                    .putString(KEY_PENDING_ACTIONS_QUEUE, queue.toString())
                    .apply();
        }
    }

    private static JSONArray drainQueueLocked(SharedPreferences prefs) {
        String rawQueue = prefs.getString(KEY_PENDING_ACTIONS_QUEUE, null);
        String legacySingle = prefs.getString(KEY_PENDING_ACTION, null);

        JSONArray queue = new JSONArray();
        if (rawQueue != null && !rawQueue.isEmpty()) {
            try {
                queue = new JSONArray(rawQueue);
            } catch (JSONException ignored) {
                queue = new JSONArray();
            }
        } else if (legacySingle != null && !legacySingle.isEmpty()) {
            try {
                queue.put(new JSONObject(legacySingle));
            } catch (JSONException ignored) {
            }
        }

        prefs.edit()
                .remove(KEY_PENDING_ACTIONS_QUEUE)
                .remove(KEY_PENDING_ACTION)
                .apply();

        return queue;
    }

    @Override
    public void load() {
        super.load();
        Context context = getContext();
        if (context == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefsListener = (sharedPreferences, key) -> {
            if (!KEY_PENDING_ACTIONS_QUEUE.equals(key)) return;
            if (!hasListeners("carAction")) return;

            JSONArray drained;
            synchronized (VectoCarBridgePlugin.class) {
                drained = drainQueueLocked(sharedPreferences);
            }

            for (int i = 0; i < drained.length(); i++) {
                JSONObject item = drained.optJSONObject(i);
                if (item == null) continue;
                try {
                    JSObject payload = JSObject.fromJSONObject(item);
                    notifyListeners("carAction", payload);
                } catch (JSONException ignored) {
                }
            }
        };
        prefs.registerOnSharedPreferenceChangeListener(prefsListener);
    }

    @Override
    protected void handleOnDestroy() {
        Context context = getContext();
        if (context != null && prefsListener != null) {
            context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .unregisterOnSharedPreferenceChangeListener(prefsListener);
        }
        prefsListener = null;
        super.handleOnDestroy();
    }

    @PluginMethod
    public void syncJobs(PluginCall call) {
        JSArray jobs = call.getArray("jobs");
        String activeJobId = call.getString("activeJobId", "");
        String driverName = call.getString("driverName", "");
        String companyName = call.getString("companyName", "");

        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
                .putString(KEY_JOBS_JSON, jobs != null ? jobs.toString() : "[]")
                .putString(KEY_ACTIVE_JOB_ID, activeJobId)
                .putString(KEY_DRIVER_NAME, driverName)
                .putString(KEY_COMPANY_NAME, companyName)
                .apply();

        call.resolve();
    }

    @PluginMethod
    public void drainPendingCarActions(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        JSONArray queue;
        synchronized (VectoCarBridgePlugin.class) {
            queue = drainQueueLocked(prefs);
        }

        JSObject ret = new JSObject();
        ret.put("actions", queue.toString());
        call.resolve(ret);
    }

    @PluginMethod
    public void getPendingCarAction(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String firstAction = null;
        synchronized (VectoCarBridgePlugin.class) {
            JSONArray queue = drainQueueLocked(prefs);
            if (queue.length() > 0) {
                JSONObject first = queue.optJSONObject(0);
                if (first != null) {
                    firstAction = first.toString();
                }
                if (queue.length() > 1) {
                    JSONArray remainder = new JSONArray();
                    for (int i = 1; i < queue.length(); i++) {
                        Object item = queue.opt(i);
                        if (item != null) remainder.put(item);
                    }
                    prefs.edit().putString(KEY_PENDING_ACTIONS_QUEUE, remainder.toString()).apply();
                }
            }
        }

        JSObject ret = new JSObject();
        ret.put("action", firstAction);
        call.resolve(ret);
    }
}
