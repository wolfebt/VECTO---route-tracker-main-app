package vecto.app.car;

import android.content.Intent;
import android.net.Uri;

import androidx.annotation.NonNull;
import androidx.car.app.CarContext;
import androidx.car.app.CarToast;
import androidx.car.app.Screen;
import androidx.car.app.model.Action;
import androidx.car.app.model.ActionStrip;
import androidx.car.app.model.Pane;
import androidx.car.app.model.PaneTemplate;
import androidx.car.app.model.Row;
import androidx.car.app.model.Template;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class JobDetailCarScreen extends Screen {
    private static final int MAX_NOTES_LENGTH = 200;

    private final JSONObject job;

    public JobDetailCarScreen(@NonNull CarContext carContext, @NonNull JSONObject job) {
        super(carContext);
        this.job = job;
    }

    @NonNull
    @Override
    public Template onGetTemplate() {
        final String jobId = job.optString("id", "");
        final String title = job.optString("title", "Job Details");
        final String destination = job.optString("destination", "");
        final String stopSummary = job.optString("stopSummary", "");
        final String customer = job.optString("customer", "");
        final String notes = job.optString("notes", "");
        final String phone = job.optString("phone", "");
        final String rawStatus = job.optString("status", "assigned");
        final int totalStopCount = job.optInt("totalStopCount", 1);
        final int remainingStopCount = job.optInt("remainingStopCount", 1);
        final String currentStopId = job.optString("currentStopId", "");
        final int currentStopNumber = job.optInt("currentStopNumber", 1);
        final JSONArray remainingStops = job.optJSONArray("remainingStops");

        final boolean isInProgress = "in-progress".equalsIgnoreCase(rawStatus)
                || "in progress".equalsIgnoreCase(rawStatus);
        final String statusLabel = JobListCarScreen.formatStatusLabel(rawStatus);

        Pane.Builder paneBuilder = new Pane.Builder();

        paneBuilder.addRow(new Row.Builder()
                .setTitle("Status")
                .addText(statusLabel)
                .build());

        String locationDisplay = !stopSummary.isEmpty() ? stopSummary : destination;
        if (!locationDisplay.isEmpty()) {
            paneBuilder.addRow(new Row.Builder()
                    .setTitle("Destination")
                    .addText(locationDisplay)
                    .build());
        }

        if (!customer.isEmpty() || !phone.isEmpty()) {
            String contactDisplay = !customer.isEmpty() && !phone.isEmpty()
                    ? customer + " (" + phone + ")"
                    : (!customer.isEmpty() ? customer : phone);
            paneBuilder.addRow(new Row.Builder()
                    .setTitle("Contact")
                    .addText(contactDisplay)
                    .build());
        }

        if (!notes.isEmpty()) {
            String truncatedNotes = notes.length() > MAX_NOTES_LENGTH
                    ? notes.substring(0, MAX_NOTES_LENGTH - 3) + "..."
                    : notes;
            paneBuilder.addRow(new Row.Builder()
                    .setTitle("Instructions")
                    .addText(truncatedNotes)
                    .build());
        }

        // PaneTemplate allows at most 2 actions directly on the Pane.
        paneBuilder.addAction(new Action.Builder()
                .setTitle("Navigate")
                .setOnClickListener(() -> {
                    String navQuery = !destination.isEmpty() ? destination : title;
                    if (navQuery.isEmpty()) {
                        CarToast.makeText(getCarContext(), "No destination available", CarToast.LENGTH_SHORT).show();
                        return;
                    }
                    Intent navIntent = new Intent(
                            CarContext.ACTION_NAVIGATE,
                            Uri.parse("geo:0,0?q=" + Uri.encode(navQuery))
                    );
                    try {
                        getCarContext().startCarApp(navIntent);
                    } catch (Exception e) {
                        CarToast.makeText(getCarContext(), "Navigation app unavailable", CarToast.LENGTH_SHORT).show();
                    }
                })
                .build());

        if (isInProgress && remainingStopCount > 1) {
            final String stopButtonLabel = "Done Stop #" + currentStopNumber;
            paneBuilder.addAction(new Action.Builder()
                    .setTitle(stopButtonLabel)
                    .setOnClickListener(() -> {
                        if (jobId.isEmpty()) return;
                        try {
                            JSONObject action = new JSONObject();
                            action.put("type", "complete_stop");
                            action.put("jobId", jobId);
                            if (!currentStopId.isEmpty()) {
                                action.put("stopId", currentStopId);
                            }
                            action.put("timestamp", System.currentTimeMillis());

                            VectoCarBridgePlugin.enqueueCarAction(getCarContext(), action);

                            int nextRemainingCount = Math.max(1, remainingStopCount - 1);
                            job.put("remainingStopCount", nextRemainingCount);
                            if (remainingStops != null && remainingStops.length() > 1) {
                                JSONArray nextStops = new JSONArray();
                                for (int i = 1; i < remainingStops.length(); i++) {
                                    Object item = remainingStops.opt(i);
                                    if (item != null) nextStops.put(item);
                                }
                                job.put("remainingStops", nextStops);
                                JSONObject nextStopObj = nextStops.optJSONObject(0);
                                if (nextStopObj != null) {
                                    String nextAddr = nextStopObj.optString("address", destination);
                                    String nextStopId = nextStopObj.optString("id", "");
                                    int nextStopNum = nextStopObj.optInt("stopNumber", currentStopNumber + 1);
                                    job.put("destination", nextAddr);
                                    job.put("currentStopId", nextStopId);
                                    job.put("currentStopNumber", nextStopNum);
                                    job.put("stopSummary", nextRemainingCount + "/" + totalStopCount + " stops remaining · Next: " + nextAddr);
                                }
                            }

                            CarToast.makeText(
                                    getCarContext(),
                                    "Stop #" + currentStopNumber + " done — Next stop ready",
                                    CarToast.LENGTH_SHORT
                            ).show();
                            invalidate();
                        } catch (JSONException e) {
                            CarToast.makeText(getCarContext(), "Failed to queue stop update", CarToast.LENGTH_SHORT).show();
                        }
                    })
                    .build());
        } else {
            final String nextStatus = isInProgress ? "completed" : "in-progress";
            final String buttonLabel = isInProgress ? "Complete Job" : "Start Trip";

            paneBuilder.addAction(new Action.Builder()
                    .setTitle(buttonLabel)
                    .setOnClickListener(() -> {
                        if (jobId.isEmpty()) return;
                        try {
                            JSONObject action = new JSONObject();
                            action.put("type", "update_status");
                            action.put("jobId", jobId);
                            action.put("status", nextStatus);
                            action.put("timestamp", System.currentTimeMillis());

                            VectoCarBridgePlugin.enqueueCarAction(getCarContext(), action);
                            job.put("status", nextStatus);
                            CarToast.makeText(
                                    getCarContext(),
                                    "Updated: " + JobListCarScreen.formatStatusLabel(nextStatus),
                                    CarToast.LENGTH_SHORT
                            ).show();
                            invalidate();
                        } catch (JSONException e) {
                            CarToast.makeText(getCarContext(), "Failed to queue update", CarToast.LENGTH_SHORT).show();
                        }
                    })
                    .build());
        }

        PaneTemplate.Builder templateBuilder = new PaneTemplate.Builder(paneBuilder.build())
                .setTitle(title)
                .setHeaderAction(Action.BACK);

        if (!phone.isEmpty()) {
            ActionStrip actionStrip = new ActionStrip.Builder()
                    .addAction(new Action.Builder()
                            .setTitle("Call")
                            .setOnClickListener(() -> {
                                Intent dialIntent = new Intent(
                                        Intent.ACTION_DIAL,
                                        Uri.parse("tel:" + phone)
                                );
                                try {
                                    getCarContext().startCarApp(dialIntent);
                                } catch (Exception e) {
                                    CarToast.makeText(getCarContext(), "Dialer unavailable", CarToast.LENGTH_SHORT).show();
                                }
                            })
                            .build())
                    .build();
            templateBuilder.setActionStrip(actionStrip);
        }

        return templateBuilder.build();
    }
}
