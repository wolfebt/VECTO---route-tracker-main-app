package vecto.app.car;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.ItemList;
import androidx.car.app.model.ListTemplate;
import androidx.car.app.model.MessageTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;
import androidx.lifecycle.DefaultLifecycleObserver;
import androidx.lifecycle.LifecycleOwner;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class JobListCarScreen extends Screen implements DefaultLifecycleObserver {
    private static final int MAX_LIST_ITEMS = 6;

    private final SharedPreferences prefs;
    private final SharedPreferences.OnSharedPreferenceChangeListener prefsListener;

    public JobListCarScreen(@NonNull CarContext carContext) {
        super(carContext);
        this.prefs = carContext.getSharedPreferences(VectoCarBridgePlugin.PREFS_NAME, Context.MODE_PRIVATE);
        this.prefsListener = (sharedPreferences, key) -> {
            if (VectoCarBridgePlugin.KEY_JOBS_JSON.equals(key)
                    || VectoCarBridgePlugin.KEY_COMPANY_NAME.equals(key)
                    || VectoCarBridgePlugin.KEY_ACTIVE_JOB_ID.equals(key)) {
                invalidate();
            }
        };
        getLifecycle().addObserver(this);
    }

    @Override
    public void onStart(@NonNull LifecycleOwner owner) {
        prefs.registerOnSharedPreferenceChangeListener(prefsListener);
    }

    @Override
    public void onStop(@NonNull LifecycleOwner owner) {
        prefs.unregisterOnSharedPreferenceChangeListener(prefsListener);
    }

    public static String formatStatusLabel(String status) {
        if (status == null || status.trim().isEmpty()) {
            return "Assigned";
        }
        String normalized = status.trim().toLowerCase();
        switch (normalized) {
            case "in-progress":
            case "in progress":
                return "In Progress";
            case "completed":
            case "complete":
                return "Completed";
            case "pending-completion":
                return "Pending Completion";
            case "assigned":
                return "Assigned";
            case "unassigned":
                return "Unassigned";
            default:
                return status;
        }
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        String jobsJson = prefs.getString(VectoCarBridgePlugin.KEY_JOBS_JSON, "[]");
        String companyName = prefs.getString(VectoCarBridgePlugin.KEY_COMPANY_NAME, "Vecto Fleet");
        if (companyName == null || companyName.trim().isEmpty()) {
            companyName = "Vecto Fleet";
        }
        String headerTitle = companyName + " — Jobs";

        ActionStrip actionStrip = new ActionStrip.Builder()
                .addAction(new Action.Builder()
                        .setTitle("Refresh")
                        .setOnClickListener(this::invalidate)
                        .build())
                .build();

        JSONArray jobs;
        try {
            jobs = new JSONArray(jobsJson);
        } catch (JSONException e) {
            jobs = new JSONArray();
        }

        if (jobs.length() == 0) {
            return new MessageTemplate.Builder(
                    "No active jobs assigned to you.\nOpen Vecto on your phone to check dispatch."
            )
                    .setTitle(headerTitle)
                    .setHeaderAction(Action.APP_ICON)
                    .setActionStrip(actionStrip)
                    .build();
        }

        ItemList.Builder listBuilder = new ItemList.Builder();
        int count = Math.min(jobs.length(), MAX_LIST_ITEMS);

        for (int i = 0; i < count; i++) {
            JSONObject job = jobs.optJSONObject(i);
            if (job == null) continue;

            final String title = job.optString("title", "Unnamed Job");
            final String stopSummary = job.optString("stopSummary", "");
            final String destination = job.optString("destination", "No destination");
            final String locationText = !stopSummary.isEmpty() ? stopSummary : destination;
            final String statusLabel = formatStatusLabel(job.optString("status", "assigned"));
            final String customer = job.optString("customer", "");

            String metaLine = customer.isEmpty() ? statusLabel : statusLabel + " • " + customer;

            Row row = new Row.Builder()
                    .setTitle(title)
                    .addText(metaLine)
                    .addText(locationText)
                    .setBrowsable(true)
                    .setOnClickListener(() ->
                            getScreenManager().push(new JobDetailCarScreen(getCarContext(), job))
                    )
                    .build();

            listBuilder.addItem(row);
        }

        return new ListTemplate.Builder()
                .setSingleList(listBuilder.build())
                .setTitle(headerTitle)
                .setHeaderAction(Action.APP_ICON)
                .setActionStrip(actionStrip)
                .build();
    }
}
