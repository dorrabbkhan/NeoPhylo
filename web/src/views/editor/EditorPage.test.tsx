// EditorPage mode-switch test (v1.4d Task 10, fix round 2): the
// "What are you making?" radios hide the inactive editor (`hidden`
// on a wrapper) instead of unmounting it — once a mode has been
// visited its editor stays mounted, so typed work survives any
// number of toggles. The reading editor still mounts lazily: it is
// not in the DOM until its radio is picked the first time.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EditorPage } from "./EditorPage";

afterEach(cleanup);

const exerciseRadio = () =>
  screen.getByRole("radio", { name: "Distance exercise" });
const readingRadio = () =>
  screen.getByRole("radio", { name: "Tree reading set" });
const exerciseTitle = () =>
  screen.queryByRole("textbox", { name: "Title" });
const setTitle = () =>
  screen.queryByRole("textbox", { name: "Set title" });

describe("EditorPage mode switch", () => {
  it("keeps both editors mounted after a visit — unsaved work survives toggling", async () => {
    render(<EditorPage />);

    // The engine + starter tree load asynchronously; the exercise
    // editor mounts first, the reading editor not at all yet.
    const title = (await screen.findByRole("textbox", {
      name: "Title",
    })) as HTMLInputElement;
    expect(setTitle()).toBeNull();
    fireEvent.change(title, { target: { value: "My exercise" } });

    // First pick of the reading mode mounts the lazy chunk and hides
    // (does not unmount) the exercise editor.
    fireEvent.click(readingRadio());
    const set = (await screen.findByRole("textbox", {
      name: "Set title",
    })) as HTMLInputElement;
    // `hidden` takes the wrapper out of the accessibility tree, so a
    // role query no longer finds the exercise Title.
    expect(exerciseTitle()).toBeNull();
    fireEvent.change(set, { target: { value: "My reading set" } });

    // Back to the exercise editor: the typed Title is still there and
    // the reading editor is hidden instead of unmounted.
    fireEvent.click(exerciseRadio());
    const back = exerciseTitle() as HTMLInputElement;
    expect(back).not.toBeNull();
    expect(back.value).toBe("My exercise");
    expect(setTitle()).toBeNull();

    // And the reading editor kept its input too.
    fireEvent.click(readingRadio());
    const setAgain = setTitle() as HTMLInputElement;
    expect(setAgain).not.toBeNull();
    expect(setAgain.value).toBe("My reading set");
    expect(exerciseTitle()).toBeNull();
  });
});
